const { tsconfigPaths } = require('esbuild-plugin-tsconfig-paths');

module.exports = {
  plugins: [tsconfigPaths()],
};
