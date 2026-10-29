import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Plugin to handle native .node binary files and optional native dependencies
// for self-contained Single Executable Application (SEA) bundles.
const nativeNodeModulesPlugin = {
  name: 'native-node-modules',
  setup(build) {
    // Intercept any required .node files (e.g. sshcrypto.node, cpufeatures.node)
    // and replace them with a throwing shim so that try/catch fallbacks in ssh2 activate
    build.onResolve({ filter: /\.node$/ }, args => ({
      path: args.path,
      namespace: 'native-node-shim',
    }));

    build.onLoad({ filter: /.*/, namespace: 'native-node-shim' }, () => ({
      contents: `
        // Standalone Single Executable Application shim:
        // Native binary C++ addon is not bundled; ssh2 seamlessly falls back to Node.js built-in crypto.
        throw new Error('Native binary addon (.node) not available in standalone executable mode.');
      `,
      loader: 'js',
    }));

    // Intercept cpu-features optional module to prevent bundling native binaries
    build.onResolve({ filter: /^cpu-features$/ }, () => ({
      path: 'cpu-features',
      namespace: 'cpu-features-shim',
    }));

    build.onLoad({ filter: /.*/, namespace: 'cpu-features-shim' }, () => ({
      contents: `
        // Safe no-op fallback for cpu-features
        module.exports = () => null;
      `,
      loader: 'js',
    }));
  },
};

console.log('📦 Bundling server.js into dist-server/bundle.cjs for SEA...');

await esbuild.build({
  entryPoints: [path.join(rootDir, 'server.js')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: path.join(rootDir, 'dist-server', 'bundle.cjs'),
  plugins: [nativeNodeModulesPlugin],
  logLevel: 'info',
});

console.log('✅ Successfully bundled server.js for Single Executable Application.');
