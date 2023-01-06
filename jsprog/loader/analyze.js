const { Chunk } = require('./structs.js');

module.exports = {
	ProcessAllChunks: async function(processor, buf, sectionTables, header, importList) {
		const newChunks = [], chunkRanges = [], allChunks = [], externalChunks = [];
		
		let virtualAddress = header.formalEntryPoint;
		while (true) {
			const chunkSection = sectionTables.find(x => x.addrStart <= virtualAddress && x.addrEnd >= virtualAddress);
			const chunkOffset = virtualAddress - chunkSection.addrStart;
			const imageOffset = chunkOffset + chunkSection.dataPointer;
			
			//console.log(`Processing chunk at section offset 0x${chunkOffset.toString(16).toUpperCase()}, image offset 0x${imageOffset.toString(16).toUpperCase()}, virtual address 0x${virtualAddress.toString(16).toUpperCase()}`);
		
			// check if this chunk was already processed at some point
			if (!chunkRanges.some(x => x.chunkRangeStart <= virtualAddress && x.chunkRangeEnd > virtualAddress)) {
				// process the chunk
				const currChunk = await processor(buf, virtualAddress, imageOffset, [], importList, sectionTables);
				if (currChunk.error) return;
				// register the chunks still to be explored
				for (var x of currChunk.outstandingChunks) {
					if (!newChunks.includes(x)) newChunks.push(x);
				}
				// register external chunks which may be processed later
				for (var x of currChunk.externalChunks) {
					if (!externalChunks.includes(x)) externalChunks.push(x);
				}
				// register the chunk ranges associated with this chunk
				for (var x of currChunk.chunkRanges) {
					if (!chunkRanges.includes(x)) chunkRanges.push(x);
				}
				// store the current chunk
				const chunkFinal = Chunk(currChunk.chunkName, currChunk.chunkData, currChunk.chunkRanges, []);
				allChunks.push(chunkFinal);
			}
			
			// check if chunk processing is complete
			if (newChunks.length === 0) {
				console.log(`Chunk processing completed successfully.`);
				break;
			}
			// progress to the new chunk
			virtualAddress = newChunks.shift();
		}

		return allChunks;
	},
	FixupChunkReferences: async function(processor, chunks, sectionTables, importList, buf) {
		// iterate all chunks in order to fixup references to addresses
		// (in e.g. JMP, CALL, etc...)
		// this also generates a list of branch targets per chunk
		for (const chunk of chunks) {	
			for (const instruction of chunk.instructions) {
				const res = await processor(chunk, instruction, chunks, importList, sectionTables, buf);
				if (!res) {
					console.log("Failed to process instruction references.");
					return false;
				}
			}
		}
		return true;
	}
};