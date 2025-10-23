await Bun.build({
	entrypoints: ['./src/cli.tsx'],
	outdir: './dist',
	target: 'node',
	external: ['react-devtools-core'],
	minify: true,
});
