await Bun.build({
	entrypoints: ["./src/cli.tsx"],
	outdir: "./dist",
	target: "node",
	format: "esm",
	minify: true,
	// external: ['react-devtools-core'],
	// splitting: true
});

// Copy yoga.wasm to dist folder
await Bun.write(
	"./dist/yoga.wasm",
	Bun.file("./node_modules/yoga-wasm-web/dist/yoga.wasm")
);
