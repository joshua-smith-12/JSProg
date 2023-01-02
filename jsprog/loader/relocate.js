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
            
            // failsafe
            if (blockSize === 0) break;
            
            console.log("Processing relocation on page at 0x" + blockPage.toString(16).toUpperCase().padStart(8, '0') + " of block length " + blockSize);
            
            // read each relocation hint
            for (let i = 8; i < blockSize; i = i + 2) {
                const hintPointer = blockAddr + i;
                const hintValue = buf.readUInt16LE(hintPointer);
                const relocType = (hintValue & 0xF000) >>> 12;
                const relocOffset = hintValue & 0x0FFF;
                
                console.log("Applying relocation with type " + relocType + ", offset " + relocOffset);
            
            }
            
            blockAddr = blockAddr + blockSize;
        }
    }
};