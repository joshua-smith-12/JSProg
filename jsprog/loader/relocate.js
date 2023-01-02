module.exports = {
    ApplyRelocations: async function(chunks, sectionTables, buf, virtualBase = 4 * 1024 * 1024) {
        console.log("Applying relocations with an image virtual base address of 0x" + virtualBase.toString(16).toUpperCase().padStart(8, '0'));
    
        // load the reloc section if it exists
        const relocIndex = sectionTables.findIndex(x => x.name === ".reloc");
        // no relocations, image may not be relocatable
        if (relocIndex === -1) return;
        
        const reloc = sectionTables[relocIndex];
        console.log(reloc);
    }
};