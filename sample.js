const fs = require('fs').promises;
const parser = require('./jsprog/loader/parser.js');


async function processor(file) {
	console.log(`Attempting to load PE image from ${file}`);
	
	const fileData = await fs.readFile(file, 'binary');
	const fileBuffer = Buffer.from(fileData, 'binary');
	
	await parser.tryParsePE(fileBuffer);
}

processor('./hw2.exe');