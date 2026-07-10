// `import "katex/dist/katex.min.css"` is resolved by the metro web bundler but
// not by Jest. Map *.css to this empty module so reader tests can import the
// component under test.
module.exports = {};
