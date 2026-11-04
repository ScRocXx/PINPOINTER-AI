/* eslint-env node */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'icon-source.png');
const outDir = path.join(__dirname, '../android/app/src/main/res');

const sizes = {
    mdpi: 48,
    hdpi: 72,
    xhdpi: 96,
    xxhdpi: 144,
    xxxhdpi: 192
};

async function generateIcons() {
    if (!fs.existsSync(inputFile)) {
        console.error('Error: Could not find ' + inputFile);
        process.exit(1);
    }

    for (const [density, size] of Object.entries(sizes)) {
        const dir = path.join(outDir, `mipmap-${density}`);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const outSquare = path.join(dir, 'ic_launcher.png');
        const outRound = path.join(dir, 'ic_launcher_round.png');

        console.log(`Generating ${density} (${size}x${size})...`);

        // Standard square icon
        await sharp(inputFile)
            .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .toFile(outSquare);

        // Round background mask for ic_launcher_round
        const circleSvg = `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#ffffff"/></svg>`;

        await sharp(inputFile)
            .resize(size, size, { fit: 'cover' })
            .composite([{
                input: Buffer.from(circleSvg),
                blend: 'dest-in'
            }])
            .png()
            .toFile(outRound);
    }

    console.log('All icons generated successfully!');
}

generateIcons().catch(console.error);
