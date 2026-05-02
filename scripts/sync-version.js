/**
 * File Purpose: scripts/sync-version.js
 * Responsibilities: Explain intent, contracts, and expected maintenance boundaries.
 * QA Notes: Preserve deterministic behavior and document validation assumptions.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuración base
const BASE_COMMIT = 180;
const INITIAL_VERSION_MAJOR = 1;
const INITIAL_VERSION_MINOR = 5;
const COMMITS_PER_MINOR = 20;

function getCommitCount() {
    try {
        const count = execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim();
        return parseInt(count, 10);
    } catch (error) {
        console.error('Error obteniendo el conteo de commits:', error.message);
        process.exit(1);
    }
}

function calculateVersion(commits) {
    const diff = commits - BASE_COMMIT;
    if (diff < 0) {
        return `${INITIAL_VERSION_MAJOR}.${INITIAL_VERSION_MINOR}.0-beta`;
    }
    
    const minorIncrement = Math.floor(diff / COMMITS_PER_MINOR);
    const patch = diff % COMMITS_PER_MINOR;
    
    const major = INITIAL_VERSION_MAJOR;
    const minor = INITIAL_VERSION_MINOR + minorIncrement;
    
    return `${major}.${minor}.${patch}-beta`;
}

const totalCommits = getCommitCount();
const newVersion = calculateVersion(totalCommits);
const today = new Date().toISOString().split('T')[0];

console.log(`Sincronizando versión basada en ${totalCommits} commits...`);
console.log(`Nueva versión calculada: v${newVersion}`);

// 1. Actualizar package.json files
const rootDir = path.resolve(__dirname, '..');
const paths = [
    path.join(rootDir, 'frontend', 'package.json'),
    path.join(rootDir, 'backend', 'package.json')
];

paths.forEach(p => {
    if (fs.existsSync(p)) {
        const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
        pkg.version = newVersion;
        fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
        console.log(`Actualizado: ${path.relative(rootDir, p)}`);
    }
});

// 2. Actualizar README.md
const readmePath = path.join(rootDir, 'README.md');
if (fs.existsSync(readmePath)) {
    let readme = fs.readFileSync(readmePath, 'utf8');
    // Actualizar badges o texto de versión (asumiendo formato vX.X.X)
    readme = readme.replace(/v\d+\.\d+\.\d+(-beta)?/g, `v${newVersion}`);
    // Actualizar fecha en el changelog del README si existe
    readme = readme.replace(/Changelog v\d+\.\d+\.\d+ \(\d{2}-\d{2}-\d{4}\)/g, `Changelog v${newVersion} (${today.split('-').reverse().join('-')})`);
    fs.writeFileSync(readmePath, readme);
    console.log('Actualizado: README.md');
}

// 3. Actualizar CHANGELOG.md
const changelogPath = path.join(rootDir, 'docs', 'CHANGELOG.md');
if (fs.existsSync(changelogPath)) {
    let changelog = fs.readFileSync(changelogPath, 'utf8');
    const versionHeader = `## [v${newVersion}] - ${today}`;
    
    // Si la versión ya existe en el changelog (por ejecuciones repetidas), no duplicar
    if (!changelog.includes(versionHeader)) {
        // Insertar después del encabezado principal
        const lines = changelog.split('\n');
        let insertIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('## ')) {
                insertIndex = i;
                break;
            }
        }
        
        if (insertIndex !== -1) {
            const newContent = [
                `## [v${newVersion}] - ${today}`,
                '',
                '### Automático',
                `- Sincronización de versión basada en iteraciones de Git (${totalCommits} commits totales).`,
                '',
            ];
            lines.splice(insertIndex, 0, ...newContent);
            fs.writeFileSync(changelogPath, lines.join('\n'));
            console.log('Actualizado e insertado en: docs/CHANGELOG.md');
        }
    }
}
