const fs = require('fs').promises;
const parser = require('./jsprog/loader/parser.js');
const emitter = require('./jsprog/loader/emit.js');


async function processor(file) {
	console.log(`Attempting to load PE image from ${file}`);
	
	const fileData = await fs.readFile(file, 'binary');
	const fileBuffer = Buffer.from(fileData, 'binary');
	
	const { codeChunkSet, header } = await parser.tryParsePE(fileBuffer);
	const { optionalHeader } = header;
	const { imageMajorVersion, imageMinorVersion } = optionalHeader;
	await fs.mkdir(`./chunks/${file}@${imageMajorVersion}.${imageMinorVersion}/`, { recursive: true });
	let chunkIndex = 0;
	for (const chunk of codeChunkSet) {
		await fs.writeFile(`./chunks/${file}@${imageMajorVersion}.${imageMinorVersion}/chunks.${chunkIndex}.${chunk.name}`, JSON.stringify(chunk, null, 4));
		const wasmBytes = await emitter.assemble(chunk, true);
		await fs.writeFile(`./chunks/${file}@${imageMajorVersion}.${imageMinorVersion}/chunks.${chunkIndex}.wasm`, Buffer.from(wasmBytes), 'binary');
		chunkIndex = chunkIndex + 1;
	}
}

processor('./hw2.exe');
