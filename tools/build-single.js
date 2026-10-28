// Собирает один самодостаточный файл dist/hotel-dashboard.html (стили и скрипты внутри) — его можно открыть двойным щелчком или отправить на iPhone.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let html = read('index.html');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/, (_, p) => '<style>\n' + read(p) + '\n</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, p) => '<script>\n' + read(p).replace(/<\/script>/g, '<\\/script>') + '\n</script>');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'hotel-dashboard.html'), html);
console.log('dist/hotel-dashboard.html', Math.round(html.length / 1024) + ' КБ');
