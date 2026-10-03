import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
const report = new URL('../docs/demo/report.html', import.meta.url)
createServer(async (_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(await readFile(report))
}).listen(48173, '127.0.0.1', () => console.log('Demo preview: http://127.0.0.1:48173'))
