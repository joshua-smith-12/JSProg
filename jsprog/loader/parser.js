const analysis = require('./analyzer.js');
const {
	DataDirectory,
	SectionHeader,
	ImportDirectory,
	ImportHint,
	DllImportDefinition
} = require('./structs.js');

const { 
    getNullTerminatedString 
} = require('./utils.js')

const IMPORT_RVA_STATIC_IDX = 1;

async function tryParseHeader(fileBuffer) {
	// read DOS signature
	if(fileBuffer.readUInt16LE(0x00) !== 0x5A4D) {
		console.log('Invalid DOS header, input is not a PE image!');
		return false;
	}
	
	// read offset of PE header
	const headerBase = fileBuffer.readUInt32LE(0x3C);
	
	// read PE signature
	if(fileBuffer.readUInt32LE(headerBase) !== 0x00004550) {
		console.log('Invalid PE header, input is not a PE image!');
		return false;
	}
	
	// image validated from signatures, start reading important items
	const machineType = fileBuffer.readUInt16LE(headerBase + 0x04);
	const sectionCount = fileBuffer.readUInt16LE(headerBase + 0x06);
	const optionalHeaderSize = fileBuffer.readUInt16LE(headerBase + 0x14);
	const imageCharacteristics = fileBuffer.readUInt16LE(headerBase + 0x16);
	
	if (machineType !== 0x8664 && machineType !== 0x14C) {
		console.log('Unsupported image, machine type does not match! (Supported machine types: IMAGE_FILE_MACHINE_AMD64, IMAGE_FILE_MACHINE_I386)');
		return false;
	}
	
	if (imageCharacteristics & 0x02 !== 1) {
		console.log('Invalid image, characteristics indicate linker error!');
		return false;
	}
	
	// offset of optional header
	const optionalHeaderBase = headerBase + 0x18;
	
	// read important fields
	const optionalHeaderMagic = fileBuffer.readUInt16LE(optionalHeaderBase + 0x00);
	const textSectionSize = fileBuffer.readUInt32LE(optionalHeaderBase + 0x04);
	const dataSectionSize = fileBuffer.readUInt32LE(optionalHeaderBase + 0x08);
	const bssSectionSize = fileBuffer.readUInt32LE(optionalHeaderBase + 0x0C);
	
	const imageEntryPoint = fileBuffer.readUInt32LE(optionalHeaderBase + 0x10);
	const imageCodeBase = fileBuffer.readUInt32LE(optionalHeaderBase + 0x14);
	const imageDataBase = fileBuffer.readUInt32LE(optionalHeaderBase + 0x18);
	const imagePreferredBase = fileBuffer.readUInt32LE(optionalHeaderBase + 0x1C);
	
	const formalEntryPoint = imagePreferredBase + imageEntryPoint;
	
	if (optionalHeaderMagic !== 0x010B) {
		console.log('Unsupported image, PE32+ is currently not supported!');
		return false;
	}
	
	const imageMajorVersion = fileBuffer.readUInt16LE(optionalHeaderBase + 0x2C);
	const imageMinorVersion = fileBuffer.readUInt16LE(optionalHeaderBase + 0x2E);
	const subsystem = fileBuffer.readUInt16LE(optionalHeaderBase + 0x44);
	const dllCharacteristics = fileBuffer.readUInt16LE(optionalHeaderBase + 0x46);
	const rvaCount = fileBuffer.readUInt32LE(optionalHeaderBase + 0x5C);
	
	if (subsystem > 0x03) {
		console.log('Unsupported image, image subsystem is not IMAGE_SUBSYSTEM_WINDOWS_CUI, IMAGE_SUBSYSTEM_WINDOWS_GUI, or IMAGE_SUBSYSTEM_NATIVE!');
		return false;
	}
	
	console.log(`Image passed header tests with version ${imageMajorVersion}.${imageMinorVersion}`);
	
	return {
		peHeader: {
			machineType,
			optionalHeaderSize,
			imageCharacteristics
		},
		optionalHeader: {
			textSectionSize,
			dataSectionSize,
			bssSectionSize,
			imageEntryPoint,
			imageCodeBase,
			imageDataBase,
			imagePreferredBase,
			imageMajorVersion,
			imageMinorVersion,
			subsystem,
			dllCharacteristics
		},
		optionalHeaderBase,
		formalEntryPoint,
		sectionCount,
		rvaCount
	};
}

async function tryParseTables (fileBuffer, header) {
	const rvaTableBase = header.optionalHeaderBase + 0x60;
	const rvaTables = [];
	for (let i = 0; i < header.rvaCount; i++) {
		const currDirectory = DataDirectory(fileBuffer.readUInt32LE(rvaTableBase + i * 0x08 + 0x00), fileBuffer.readUInt32LE(rvaTableBase + i * 0x08 + 0x04));
		rvaTables.push(currDirectory);
	}

	const sectionTableBase = header.optionalHeaderBase + header.peHeader.optionalHeaderSize;
	const sectionTables = [];
	for (let i = 0; i < header.sectionCount; i++) {
		const currSection = SectionHeader(
			fileBuffer.toString('utf8', sectionTableBase + i*0x28 + 0x00, sectionTableBase + i*0x28 + 0x08), 
			fileBuffer.readUInt32LE(sectionTableBase + i*0x28 + 0x08), 
			fileBuffer.readUInt32LE(sectionTableBase + i*0x28 + 0x0C), 
			fileBuffer.readUInt32LE(sectionTableBase + i*0x28 + 0x10), 
			fileBuffer.readUInt32LE(sectionTableBase + i*0x28 + 0x14), 
			fileBuffer.readUInt32LE(sectionTableBase + i*0x28 + 0x18), 
			fileBuffer.readUInt16LE(sectionTableBase + i*0x28 + 0x20), 
			fileBuffer.readUInt32LE(sectionTableBase + i*0x28 + 0x24)
		);
		
		const sectionNameEnd = currSection.name.indexOf('\0') === -1 ? currSection.name.length : currSection.name.indexOf('\0');
		currSection.name = currSection.name.substring(0, sectionNameEnd);
		sectionTables.push(currSection);
	}
	
	console.log(`Successfully read ${rvaTables.length} RVA tables and ${sectionTables.length} sections from image`);
	
	return { rvaTables, sectionTables };
}

async function findImports(fileBuffer, rvaTables, sectionTables, preferredBase) {
	// identify the import section (commonly .idata, but not always)
	const importRva = rvaTables[IMPORT_RVA_STATIC_IDX];
	let importSection = null;
	for (var section of sectionTables) {
		if (section.virtualAddress <= importRva.virtualAddress && (section.virtualAddress + section.virtualSize) >= importRva.virtualAddress)
			importSection = section;
	}
	
	// base address in loaded image
	const importBaseAddress = section.virtualAddress + preferredBase;
	
	// import directory table exists at the offset of the import RVA inside the import section
	const importDirectoryTable = importSection.dataPointer + (importRva.virtualAddress - importSection.virtualAddress);
	console.log(`Import directory table found at ${importSection.name}, image offset 0x${importDirectoryTable.toString(16).toUpperCase()}`);	
	
	const importTable = [];
	let currentImportNumber = 0;
	while (true) {
		const importLookupRVA = fileBuffer.readUInt32LE(importDirectoryTable + currentImportNumber*0x14 + 0x00);
		const importNameRVA = fileBuffer.readUInt32LE(importDirectoryTable + currentImportNumber*0x14 + 0x0C);
		const importThunkRVA = fileBuffer.readUInt32LE(importDirectoryTable + currentImportNumber*0x14 + 0x10);
		
		// null entries means we reached the end of the import directory table
		if (importLookupRVA === 0x00 && importNameRVA === 0x00 && importThunkRVA === 0x00) break;
		
		const importLookupPointer = importSection.dataPointer + (importLookupRVA - importSection.virtualAddress);
		const importNamePointer = importSection.dataPointer + (importNameRVA - importSection.virtualAddress);
		const importThunkPointer = importSection.dataPointer + (importThunkRVA - importSection.virtualAddress);
		
		const importName = getNullTerminatedString(fileBuffer, importNamePointer);
		
		console.log(`Processing directory entry for import ${importName}`);
		const currImport = ImportDirectory(importName, importLookupPointer, importThunkPointer);
		importTable.push(currImport);
		
		// goto next import
		currentImportNumber += 0x01;
	}
	
	// process the import hints in each imported DLL
	// we don't care about thunks in this case since the calls will get patched over anyway during processing
	const importList = [];
	for (var importData of importTable) {
		const currImportList = [];
		const importLookupPointer = importData.lookupPointer;
		const importThunkPointer = importData.thunkPointer;
		const importSectionOffset = importData.thunkPointer - importSection.dataPointer;
		let currentLookupNumber = 0;
		while (true) {
			const currLookup = fileBuffer.readUInt32LE(importLookupPointer + currentLookupNumber*0x04);
			const currThunk = fileBuffer.readUInt32LE(importThunkPointer + currentLookupNumber*0x04);
			if (currLookup === 0x00) break;
			const virtualImportAddr = importBaseAddress + importSectionOffset + currentLookupNumber * 0x04;
			
			// ordinal vs. hint lookup
			const isOrdinal = (currLookup & 0x80000000) !== 0;
			if (isOrdinal) {
				const lookupNumber = currLookup & 0xFFFF;
				const currImport = ImportHint(lookupNumber, null, currThunk, virtualImportAddr);
				currImportList.push(currImport);
			} else {
				const hintVRA = currLookup & ~0x80000000;
				const hintPointer = importSection.dataPointer + (hintVRA - importSection.virtualAddress);
				// read the hint ID and name
				const hintID = fileBuffer.readUInt16LE(hintPointer);
				const hintName = getNullTerminatedString(fileBuffer, hintPointer + 0x02);
				const currImport = ImportHint(hintID, hintName, currThunk, virtualImportAddr);
				currImportList.push(currImport);
			}
			currentLookupNumber += 0x01;
		}
		const currImportTable = DllImportDefinition(importData.name, currImportList)
		importList.push(currImportTable);
	}
	
	return { importTable, importList, importSection };
}

async function tryParsePE(fileBuffer) {
	const header = await tryParseHeader(fileBuffer);
	if (!header) return false;
	
	const tables = await tryParseTables(fileBuffer, header);
	if (!tables) return false;
	const { rvaTables, sectionTables } = tables;
	
	const imports = await findImports(fileBuffer, rvaTables, sectionTables, header.optionalHeader.imagePreferredBase);
	if (!imports) return false;
	const { importTable, importList, importSection } = imports;
	
	// TODO: confirm existence of the indicated DLLs with the required imports, or prompt to provide them if needed
	
	// find the section containing the entry point
	let codeSection = null;
	for (var section of sectionTables) {
		if (section.virtualAddress <= header.optionalHeader.imageEntryPoint && (section.virtualAddress + section.virtualSize) >= header.optionalHeader.imageEntryPoint)
			codeSection = section;
	}
	
	const codeEntryOffset = codeSection.dataPointer + (header.optionalHeader.imageEntryPoint - codeSection.virtualAddress);
	console.log(`Identified image entry point at ${codeSection.name}, image offset 0x${codeEntryOffset.toString(16).toUpperCase()}`);
	
	// launch code analysis starting from the entrypoint
	const codeChunkSet = await analysis.ProcessAllChunks(fileBuffer, codeEntryOffset, header.formalEntryPoint);
	if (!codeChunkSet) return false;
	// fixup references in JMP/CALL
	const thunkBase = (header.optionalHeader.imagePreferredBase + importSection.virtualAddress) - importSection.dataPointer;
	const codeChunkFixup = await analysis.FixupChunkReferences(codeChunkSet, thunkBase, importSection.dataPointer + importSection.dataSize, importList, fileBuffer);
	
	return { header, tables, imports, codeChunkSet, codeEntryOffset };
}

module.exports = {
	tryParsePE
};
