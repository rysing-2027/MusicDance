const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const os = require('os');
const crypto = require('crypto');

const PORT = 3000;
const MAX_SIZE = 500 * 1024 * 1024; // 500MB per file

// 支持的音频格式
const SUPPORTED_FORMATS = {
  '.mp4': 'mp4', '.m4a': 'm4a', '.m4b': 'm4b', '.m4p': 'm4p',
  '.wav': 'wav', '.flac': 'flac', '.aac': 'aac', '.ogg': 'ogg',
  '.wma': 'wma', '.avi': 'avi', '.mov': 'mov', '.mkv': 'mkv',
  '.webm': 'webm', '.3gp': '3gp', '.mp3': 'mp3' // mp3 直接复制
};

const server = http.createServer((req, res) => {
  // 添加安全响应头
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  // 静态文件
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // 转换接口
  if (req.method === 'POST' && req.url === '/api/convert') {
    const boundary = getBoundary(req.headers['content-type']);
    if (!boundary) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        res.writeHead(413);
        res.end('文件太大');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const { fileData, filename, originalName } = extractFileWithMeta(buffer, boundary);
      if (!fileData) {
        res.writeHead(400);
        res.end('无法解析文件');
        return;
      }

      // 检查文件格式
      const ext = path.extname(originalName || filename || '').toLowerCase();
      if (!SUPPORTED_FORMATS[ext]) {
        res.writeHead(400);
        res.end('不支持的文件格式');
        return;
      }

      const id = crypto.randomBytes(8).toString('hex');
      const tmpDir = os.tmpdir();
      const inputPath = path.join(tmpDir, `${id}${ext}`);
      const outputPath = path.join(tmpDir, `${id}.mp3`);

      fs.writeFileSync(inputPath, fileData);

      // 如果已经是 mp3，直接复制
      if (ext === '.mp3') {
        const mp3 = fs.readFileSync(inputPath);
        fs.unlink(inputPath, () => {});
        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Content-Length': mp3.length,
          'Content-Disposition': `attachment; filename="${encodeURIComponent(filename.replace(/\.[^.]+$/, '.mp3'))}"`,
          'X-Original-Name': encodeURIComponent(originalName || filename)
        });
        res.end(mp3);
        return;
      }

      execFile('ffmpeg', [
        '-i', inputPath,
        '-vn', '-acodec', 'libmp3lame', '-q:a', '2',
        '-y', outputPath
      ], { timeout: 300000 }, (err) => {
        // 清理输入文件
        fs.unlink(inputPath, () => {});

        if (err) {
          console.error('FFmpeg error:', err.message);
          fs.unlink(outputPath, () => {});
          res.writeHead(500);
          res.end('转换失败');
          return;
        }

        const mp3 = fs.readFileSync(outputPath);
        fs.unlink(outputPath, () => {});

        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Content-Length': mp3.length,
          'Content-Disposition': `attachment; filename="${encodeURIComponent(filename.replace(/\.[^.]+$/, '.mp3'))}"`,
          'X-Original-Name': encodeURIComponent(originalName || filename)
        });
        res.end(mp3);
      });
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

function getBoundary(contentType) {
  if (!contentType) return null;
  const match = contentType.match(/boundary=(.+)/);
  return match ? match[1] : null;
}

function extractFileWithMeta(buffer, boundary) {
  const str = buffer.toString('binary');
  const parts = str.split('--' + boundary);
  for (const part of parts) {
    if (part.includes('filename=')) {
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;

      // 提取 filename（可能包含相对路径）
      const header = part.slice(0, headerEnd);
      let filename = '';
      let originalName = '';

      // 匹配 filename 或 filename*
      const filenameMatch = header.match(/filename\*?=["']?(?:UTF-8''|)([^"';\r\n]+)/i);
      if (filenameMatch) {
        filename = filenameMatch[1];
        // 解码可能被编码的文件名
        try {
          filename = decodeURIComponent(filename);
        } catch (e) {}
      }

      // 查找自定义的 relativepath 或其他路径信息
      const pathMatch = header.match(/name=["']?relativepath["']?[\s\S]*?filename=["']?([^"';\r\n]+)/i);
      if (pathMatch) {
        originalName = pathMatch[1];
        try {
          originalName = decodeURIComponent(originalName);
        } catch (e) {}
      }

      // 如果没有找到 originalName，使用 filename
      if (!originalName) {
        originalName = filename;
      }

      let body = part.slice(headerEnd + 4);
      if (body.endsWith('\r\n')) body = body.slice(0, -2);
      return {
        fileData: Buffer.from(body, 'binary'),
        filename: filename,
        originalName: originalName
      };
    }
  }
  return { fileData: null, filename: '', originalName: '' };
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
