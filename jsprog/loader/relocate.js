module.exports = {
    ApplyRelocations: async function(sectionTables, buf, header, virtualBase = 64 * 1024) {
        console.log("Applying relocations with an image virtual base address of 0x" + virtualBase.toString(16).toUpperCase().padStart(8, '0'));
    
        // load the reloc section if it exists
        const relocIndex = sectionTables.findIndex(x => x.name === ".reloc");
        // no relocations, image may not be relocatable
        if (relocIndex === -1) return;
        
        const reloc = sectionTables[relocIndex];
        
        let blockAddr = reloc.dataPointer;
        while (blockAddr < (reloc.dataPointer + (reloc.addrEnd - reloc.addrStart))) {
            const blockPage = buf.readUInt32LE(blockAddr);
            const blockSize = buf.readUInt32LE(blockAddr + 4);
            
            console.log("Processing relocation on page at " + blockPage.toString(16).toUpperCase().padStart(8, '0'));
            
            blockAddr = blockAddr + blockSize;
        }
    }
};