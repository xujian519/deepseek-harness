/**
 * nuo-patent is a prebuilt artifact (upstream ships dist/ only); there is no
 * tsc-emitted lib/types entry to bundle. The empty-string entry (same form the
 * root workspace config uses for the client face) declares no build inputs, so
 * the workspace build leaves the shipped dist/ untouched.
 */
export default {
  entry: '',
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
}
