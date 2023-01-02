module.exports = {
    ApplyRelocations: async function(chunks, sectionTables, buf) {
        // load the reloc section if it exists
        const relocIndex = sectionTables.findIndex(x => x.name === ".reloc");
        // no relocations, image may not be relocatable
        if (relocIndex === -1) return;
        
        const reloc = sectionTables[relocIndex];
        console.log(reloc);
    }
};