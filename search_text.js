const fs = require('fs');
const path = require('path');

function searchInDir(dir, query) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== '.dart_tool' && file !== 'build') {
        searchInDir(fullPath, query);
      }
    } else {
      if (file.endsWith('.dart') || file.endsWith('.js') || file.endsWith('.json')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.toLowerCase().includes(query.toLowerCase())) {
          console.log(`Found "${query}" in: ${fullPath}`);
          // Print matching line numbers and content
          const lines = content.split('\n');
          lines.forEach((line, idx) => {
            if (line.toLowerCase().includes(query.toLowerCase())) {
              console.log(`  Line ${idx + 1}: ${line.trim()}`);
            }
          });
        }
      }
    }
  }
}

console.log('Searching in SS_backend...');
searchInDir('E:\\SMART SYNERGIES\\SS_backend', 'dummy');
searchInDir('E:\\SMART SYNERGIES\\SS_backend', 'mock');
