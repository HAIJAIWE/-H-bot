// src/main/services/plugins/marketBundledIndex.ts
//
// **随包的离线官方市场**（2026-10-20）：不联网也有内容可装。
//
// 为什么内联而不是打包成目录：这 3 个插件的源码就是给用户看的样板，
// 内联后索引、安装、卸载走的是和远程市场完全同一条代码路径 —— 市场机制本身
// 不靠"内置目录"这种后门，离线源只是换了取索引的地方。
//
// 插件源码形状见 docs/ai/plugin-system.md §12：`module.exports.activate(api)`，
// 工具描述由 api.contributeTool 贡献，真正执行时经桥回沙箱（5s 超时）。
import { MARKET_FORMAT, type MarketIndex } from '@shared/plugins/market';

export const BUNDLED_SOURCE = 'bundled://official';

function file(path: string, text: string): { path: string; text: string } {
  return { path, text };
}

function manifestOf(name: string, description: string): string {
  return JSON.stringify(
    { name, version: '1.0.0', entry: 'index.js', ai: true, description },
    null,
    2,
  );
}

const CLOCK_ENTRY = "module.exports.activate = function activate(api) {\n  api.contributeTool({\n    name: 'market_now',\n    description: 'Return the current date and time in ISO 8601 format. Use when the user asks what time or date it is.',\n    category: 'query',\n  });\n  api.handleTool('market_now', function () {\n    return new Date().toISOString();\n  });\n};\n";
const COIN_ENTRY = "module.exports.activate = function activate(api) {\n  api.contributeTool({\n    name: 'market_coin',\n    description: 'Flip a fair coin and return \"heads\" or \"tails\". Use for simple random decisions.',\n    category: 'query',\n  });\n  api.handleTool('market_coin', function () {\n    return Math.random() < 0.5 ? 'heads' : 'tails';\n  });\n};\n";
const TEXT_ENTRY = "module.exports.activate = function activate(api) {\n  api.contributeTool({\n    name: 'market_text_stats',\n    description: 'Count characters, words and lines of a piece of text. Pass the text as args.text.',\n    category: 'query',\n    parameters: {\n      type: 'object',\n      properties: { text: { type: 'string', description: 'Text to measure' } },\n      required: ['text'],\n    },\n  });\n  api.handleTool('market_text_stats', function (args) {\n    var text = String((args && args.text) || '');\n    var chars = Array.from(text).length;\n    var words = text.trim() === '' ? 0 : text.trim().split(/\\s+/).length;\n    var lines = text === '' ? 0 : text.split(/\\r?\\n/).length;\n    return JSON.stringify({ chars: chars, words: words, lines: lines });\n  });\n};\n";

export const BUNDLED_MARKET_INDEX: MarketIndex = {
  format: MARKET_FORMAT,
  title: 'Official offline market',
  description: 'Shipped with qqbat: three small AI plugins that can be installed without network.',
  plugins: [
    {
      id: 'clock',
      name: 'market-clock',
      title: 'Clock',
      description: 'Tells the current date and time (ISO 8601) through the market_now tool.',
      author: 'qqbat',
      versions: [
        {
          version: '1.0.0',
          requires: '>=0.1.0',
          files: [
            file('manifest.json', manifestOf('market-clock', 'Current time, via market_now.')),
            file('index.js', CLOCK_ENTRY),
          ],
        },
      ],
    },
    {
      id: 'coin',
      name: 'market-coin',
      title: 'Coin flip',
      description: 'A fair coin flip (heads/tails) through the market_coin tool.',
      author: 'qqbat',
      versions: [
        {
          version: '1.0.0',
          requires: '>=0.1.0',
          files: [
            file('manifest.json', manifestOf('market-coin', 'Fair coin flip, via market_coin.')),
            file('index.js', COIN_ENTRY),
          ],
        },
      ],
    },
    {
      id: 'text-stats',
      name: 'market-text',
      title: 'Text stats',
      description: 'Counts characters, words and lines through the market_text_stats tool.',
      author: 'qqbat',
      versions: [
        {
          version: '1.0.0',
          requires: '>=0.1.0',
          files: [
            file('manifest.json', manifestOf('market-text', 'Text statistics, via market_text_stats.')),
            file('index.js', TEXT_ENTRY),
          ],
        },
      ],
    },
  ],
};
