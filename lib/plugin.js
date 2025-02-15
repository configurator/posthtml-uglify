const posthtml = require('posthtml');
const postcssSafeParser = require('postcss-safe-parser');
const postcssSelectorParser = require('postcss-selector-parser');
const cssNameGenerator = require('@gorebel/css-class-generator');

const { version } = require('../package');

class HTMLUglify {
  constructor({ whitelist = [] } = {}) {
    this.version = version;
    this.whitelist = whitelist;
    this.generators = {
      id: cssNameGenerator(),
      class: cssNameGenerator(),
    };
  }

  static insertLookup(type, value, pointer, lookups) {
    if (!lookups[type]) {
      lookups[type] = {};
    }
    lookups[type][value] = pointer;
  }

  static checkForStandardPointer(type, value, lookups) {
    return lookups[type] && lookups[type][value];
  }

  static checkForAttributePointer(type, value, lookups) {
    const typeLookups = lookups[type] || {};
    const keys = Object.keys(typeLookups);
    let pointer;

    keys.some((key) => {
      if (value.indexOf(key) !== -1) {
        pointer = value.replace(key, typeLookups[key]);
        return true;
      }
      return false;
    });

    return pointer;
  }

  generatePointer(type) {
    const { value } = this.generators[type].next();
    if (this.isWhitelisted(type, value)) {
      return this.generatePointer(type);
    }

    return value;
  }

  pointer(type, value, lookups) {
    return this.constructor.checkForStandardPointer(type, value, lookups)
      || this.constructor.checkForAttributePointer(type, value, lookups)
      || this.generatePointer(type);
  }

  createLookup(type, value, lookups) {
    let pointer;
    if (value && !this.isWhitelisted(type, value)) {
      pointer = this.pointer(type, value, lookups);
      this.constructor.insertLookup(type, value, pointer, lookups);
    }
    return pointer;
  }

  isWhitelisted(type, value) {
    const prefix = type === 'id' ? '#' : '.';
    return this.whitelist.includes(`${prefix}${value}`);
  }

  pointerizeClass(node, lookups) {
    const classes = node.attrs.class;

    if (classes) {
      node.attrs.class = classes.split(/\s+/).map((value) => {
        const pointer = this.createLookup('class', value, lookups);
        if (pointer) {
          return pointer;
        }

        return value;
      }).join(' ');
    }
  }

  pointerizeIdAndFor(type, node, lookups) {
    let value = node.attrs[type];
    if (!value) {
      return;
    }

    const leadingHash = value[0] === '#';
    if (leadingHash) {
      value = value.slice(1);
    }

    const pointer = this.createLookup('id', value, lookups);
    if (pointer) {
      node.attrs[type] = (leadingHash ? '#' : '') + pointer;
    }
  }

  processRules(rules, lookups) {
    rules.forEach((rule) => {
      // go deeper inside media rule to find css rules
      if (rule.type === 'atrule' && (rule.name === 'media' || rule.name === 'supports')) {
        this.processRules(rule.nodes, lookups);
      } else if (rule.type === 'rule') {
        postcssSelectorParser((selectors) => {
          selectors.walk((selector) => {
            let pointer;

            if ((selector.type === 'class')
                || (selector.type === 'attribute' && selector.attribute === 'class')) {
              pointer = this.createLookup('class', selector.value, lookups);
            } else if ((selector.type === 'id')
                || (selector.type === 'attribute' && selector.attribute === 'id')
                || (selector.type === 'attribute' && selector.attribute === 'for')) {
              pointer = this.createLookup('id', selector.value, lookups);
            }

            if (pointer) {
              selector.value = pointer;
            }
          });

          rule.selector = String(selectors);
        }).processSync(rule.selector);
      }
    });
  }

  rewriteElements(tree, lookups = {}) {
    return tree.walk((node) => {
      if (node.attrs) {
        if (node.attrs.class) {
          this.pointerizeClass(node, lookups);
        }

        for (const attr of ['id', 'for']) {
          this.pointerizeIdAndFor(attr, node, lookups);
        }

        if (node.tag === 'use') {
          for (const attr of ['href', 'xlink:href']) {
            if (node.attrs[attr]) {
              this.pointerizeIdAndFor(attr, node, lookups);
            }
          }
        }
      }
      return node;
    });
  }

  rewriteStyles(tree, lookups = {}) {
    return tree.walk((node) => {
      if (node.tag === 'style' && node.content) {
        const ast = postcssSafeParser([].concat(node.content).join(''));
        this.processRules(ast.nodes, lookups);
        node.content = [ast.toString()];
      }
      return node;
    });
  }

  process(tree) {
    const lookups = {};
    this.generators.id = cssNameGenerator();
    this.generators.class = cssNameGenerator();
    tree = this.rewriteStyles(tree, lookups);
    tree = this.rewriteElements(tree, lookups);
    return tree;
  }
}

module.exports = (options) => {
  const plugin = new HTMLUglify(options);
  return tree => plugin.process(tree);
};

module.exports.HTMLUglify = HTMLUglify;

module.exports.process = (html, options) => { // eslint-disable-line arrow-body-style
  return posthtml().use(module.exports(options)).process(html, { sync: true });
};
