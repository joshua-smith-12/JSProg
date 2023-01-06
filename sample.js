const fs = require('fs').promises;
const parse = require('./jsprog/loader/parse.js');
const analyze = require('./jsprog/loader/analyze.js');
const assemble = require('./jsprog/loader/assemble.js');

const x86 = require('./jsprog/architectures/x86.js');

async function processor(file) {
	console.log(`Attempting to load PE image from ${file}`);
	
	const fileData = await fs.readFile(file, 'binary');
	const fileBuffer = Buffer.from(fileData, 'binary');
	
	// parse the PE file to apply relocations, identify sections, and map imports
	const parseOutput = await parse.tryParsePE(fileBuffer);
	if (!parseOutput) {
		console.log("Failed to parse PE file.");
		return false;
	}
	const { header, tables, imports, virtualBase } = parseOutput;
	// create a memory map of the data contained in each section
	const mmap = await parse.createMemoryMap(fileBuffer, tables, virtualBase);

	// output details about the program, plus the memory map
	const { optionalHeader } = header;
	const { imageMajorVersion, imageMinorVersion } = optionalHeader;
	await fs.mkdir(`./chunks/${file}@${imageMajorVersion}.${imageMinorVersion}/`, { recursive: true });
	await fs.writeFile(`./chunks/${file}@${imageMajorVersion}.${imageMinorVersion}/program.json`, JSON.stringify({ header, virtualBase, mmap: 'memory.dat' }, null, 4));
	await fs.writeFile(`./chunks/${file}@${imageMajorVersion}.${imageMinorVersion}/memory.dat`, mmap);

	// run analysis against the information gathered from parsing
	// this includes passing a chunk processor (which will be architecture-specific)
	const codeChunkSet = await analyze.ProcessAllChunks(x86.ProcessChunk, fileBuffer, tables.sectionTables, header, imports.importList);
	if (!codeChunkSet) return false;
	// fix references up as EXTERNS or properly-offset CALL and JUMP
	const fixupResult = await analyze.FixupChunkReferences(x86.FixupInstruction, codeChunkSet, tables.sectionTables, imports.importList, fileBuffer);
	if (!fixupResult) return false;

	const assembler = x86.GetAssembler();

	// output individual chunks and the associated intermediate JSON
	let chunkIndex = 0;
	for (const chunk of codeChunkSet) {
		await fs.writeFile(`./chunks/${file}@${imageMajorVersion}.${imageMinorVersion}/chunks.${chunkIndex}.json`, JSON.stringify(chunk, null, 4));
		const { wasmBytes, wasmText } = await assembler.AssembleChunk(chunk, true);
		if (!wasmBytes) {
			console.log(`Chunk assembly failed at chunk ${chunkIndex}.`);
			return false;
		}
		await fs.writeFile(`./chunks/${file}@${imageMajorVersion}.${imageMinorVersion}/chunks.${chunkIndex}.wasm`, Buffer.from(wasmBytes), 'binary');
		if (wasmText) await fs.writeFile(`./chunks/${file}@${imageMajorVersion}.${imageMinorVersion}/chunks.${chunkIndex}.txt`, wasmText);
		chunkIndex = chunkIndex + 1;
	}
}

processor('./hw2.exe');
