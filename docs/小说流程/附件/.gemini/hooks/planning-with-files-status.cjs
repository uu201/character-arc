#!/usr/bin/env node

const fs = require('node:fs');

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const input = readHookInput();
const toolName = input.tool_name;

const messages = {
  glob: '【planning-with-files】正在扫描目录定位真实文件名...',
  read_file: '【planning-with-files】正在读取上下文锚点...',
  write_file: '【planning-with-files】正在写入文件...',
  replace: '【planning-with-files】正在局部更新文件...'
};

const systemMessage = messages[toolName];

process.stdout.write(
  JSON.stringify(systemMessage ? { systemMessage } : {})
);
