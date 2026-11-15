'use strict';
// Загружает Code.gs в изолированный контекст с заглушками сервисов Google.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(overrides = {}) {
  const calls = { writes: [], mail: [] };
  const writeTrap = (name) => () => { calls.writes.push(name); throw new Error('WRITE ATTEMPT: ' + name); };
  const sandbox = {
    console,
    Session: {
      getActiveUser: () => ({ getEmail: () => overrides.email === undefined ? 'owner@example.com' : overrides.email }),
      getScriptTimeZone: () => 'Asia/Yerevan'
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (overrides.props || {})[k] || null }) },
    Utilities: {
      formatDate: (d, tz, fmt) => fmt === 'yyyy-MM-dd' ? '2026-11-15' : '15.11.2026 10:42'
    },
    HtmlService: {
      createHtmlOutput: (h) => ({ html: h, setTitle() { return this; } }),
      createHtmlOutputFromFile: (n) => ({ file: n, setTitle() { return this; }, addMetaTag() { return this; } })
    },
    SpreadsheetApp: {
      openById: (id) => {
        const data = (overrides.books || {})[id];
        if (!data) throw new Error('no access to ' + id);
        return {
          getName: () => data.title,
          getOwner: () => ({ getEmail: () => 'owner@example.com' }),
          getSheetByName: (n) => data.tabs[n] ? {
            getDataRange: () => ({ getDisplayValues: () => data.tabs[n], setValues: writeTrap('setValues') }),
            appendRow: writeTrap('appendRow'), getRange: writeTrap('getRange')
          } : null
        };
      }
    },
    MailApp: { sendEmail: writeTrap('MailApp.sendEmail') },
    GmailApp: { sendEmail: writeTrap('GmailApp.sendEmail') },
    DriveApp: new Proxy({}, { get: (_, k) => writeTrap('DriveApp.' + String(k)) })
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  vm.runInContext(src + '\n;this.__SCC = SCC;', sandbox, { filename: 'Code.gs' });
  sandbox.__calls = calls;
  return sandbox;
}
module.exports = { load };
