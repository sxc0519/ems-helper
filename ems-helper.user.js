// ==UserScript==
// @name         Japan Post EMS Helper
// @namespace    local.ems.helper
// @version      2.0.13
// @description  EMS address, parcel and PDF helper.
// @match        https://www.int-mypage.post.japanpost.jp/mypage/*.do
// @updateURL    https://raw.githubusercontent.com/sxc0519/ems-helper/main/ems-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/sxc0519/ems-helper/main/ems-helper.user.js
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  function cleanText(value) {
  return String(value || '').replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/\r\n?/g, '\n').replace(/[\u00a0\u3000]/g, ' ').split('\n').map(s => s.trim()).filter(Boolean).join('\n');
}

const COUNTRY_ALIASES = [
  [/\b(?:LAO\s*PDR|LAOS?|LAO PEOPLE'?S DEMOCRATIC REPUBLIC)\b/i, 'LAOS'],
  [/\b(?:VIET\s*NAM|VIETNAM)\b/i, 'VIET NAM'], [/\b(?:P\.?R\.?\s*CHINA|CHINA)\b/i, 'CHINA'],
  [/\b(?:HONG\s*KONG|HKSAR)\b/i, 'HONG KONG'], [/\b(?:MACAO|MACAU)\b/i, 'MACAO'],
  [/\bTHAILAND\b/i, 'THAILAND'], [/\bCAMBODIA\b/i, 'CAMBODIA'], [/\bMALAYSIA\b/i, 'MALAYSIA'],
  [/\bSINGAPORE\b/i, 'SINGAPORE'], [/\bPHILIPPINES?\b/i, 'PHILIPPINES'], [/\bINDONESIA\b/i, 'INDONESIA'],
  [/\b(?:SOUTH KOREA|REPUBLIC OF KOREA|KOREA)\b/i, 'KOREA'], [/\bTAIWAN\b/i, 'TAIWAN'],
  [/\bAUSTRALIA\b/i, 'AUSTRALIA'], [/\bCANADA\b/i, 'CANADA'],
  [/\b(?:USA|UNITED STATES(?: OF AMERICA)?)\b/i, 'UNITED STATES OF AMERICA'], [/\b(?:UK|UNITED KINGDOM)\b/i, 'UNITED KINGDOM'],
];
function countryFrom(text) { return COUNTRY_ALIASES.find(([re]) => re.test(text))?.[1] || ''; }
function stripLabel(line, labels) { return line.replace(new RegExp(`^(?:${labels})\\s*[:：]?\\s*`, 'i'), '').trim(); }
function normalizePhone(value) {
  const raw = String(value || '').trim(); const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 19) throw new Error('电话号码应为 7～19 位数字。');
  return raw.startsWith('+') ? `+${digits}` : digits;
}
function splitChineseAddress(address) {
  const compact = address.replace(/\s+/g, '').replace(/[,，;；]+$/g, '');
  const pm = compact.match(/^(内蒙古自治区|广西壮族自治区|宁夏回族自治区|新疆维吾尔自治区|西藏自治区|北京市|天津市|上海市|重庆市|[^省]{2,4}省)/);
  if (!pm) throw new Error('中国大陆地址需要包含完整省／自治区／直辖市。');
  const province = pm[1]; let tail = compact.slice(province.length); let city = '';
  if (/^(北京|天津|上海|重庆)市$/.test(province)) city = province;
  else { const m = tail.match(/^(.{2,18}?(?:自治州|地区|盟|市))/); if (m) { city = m[1]; tail = tail.slice(city.length); } }
  const dm = tail.match(/^(.{1,16}?(?:自治县|自治旗|市辖区|新区|区|县|旗|市))/);
  if (dm) { city += dm[1]; tail = tail.slice(dm[1].length); }
  if (!city || !tail) throw new Error('市区或详细地址识别不完整，请在预览中修改。');
  const street = tail.match(/^(.*?(?:街道|大道|大街|胡同|公路|路|街|巷|镇|乡))(.+)$/);
  return { province, city, address1: street ? street[2] : '', address2: street ? street[1] : tail, postal: '' };
}
function parseForeignAddress(address, country) {
  let value = address;
  for (const [re, code] of COUNTRY_ALIASES) if (code === country) value = value.replace(re, '');
  const parts = value.split(/\s*,\s*/).map(s => s.replace(/^[,;\s]+|[,;\s]+$/g, '')).filter(Boolean);
  if (parts.length < 2) throw new Error('国外地址至少需要两段逗号分隔的地址，例如 Village, District, City, Country。');
  const city = parts.pop(); const address1 = parts.shift() || ''; const address2 = parts.join(', ') || address1;
  return { province: '', city, address1, address2, postal: '' };
}
function parseAddress(raw) {
  const text = cleanText(raw); if (!text) throw new Error('请粘贴收件地址。');
  const lines = text.split('\n'); const phones = [];
  for (const line of lines) for (const value of line.match(/(?:\+|00)?\d[\d() .-]{5,}\d/g) || []) phones.push({ value, line });
  const unique = [...new Map(phones.map(x => [normalizePhone(x.value), x])).values()];
  if (unique.length !== 1) throw new Error('需要且只能识别到一个电话号码；请删除其他号码或手动填写。');
  const phoneInfo = unique[0]; const phone = normalizePhone(phoneInfo.value);
  const nameLine = lines.find(line => /^(?:contact|recipient|consignee|name|收件人|联系人|姓名)\s*[:：]/i.test(line));
  const addressLine = lines.find(line => /^(?:address|addr|收件地址|详细地址|地址)\s*[:：]/i.test(line));
  let name = nameLine ? stripLabel(nameLine, 'contact|recipient|consignee|name|收件人|联系人|姓名') : '';
  let address = addressLine ? stripLabel(addressLine, 'address|addr|收件地址|详细地址|地址') : '';
  const excluded = new Set([nameLine, phoneInfo.line, addressLine].filter(Boolean));
  const remaining = lines.filter(line => !excluded.has(line) && !/^(?:telephone|tel(?:ephone)?|phone|mobile|联系电话|电话|手机)\s*[:：]/i.test(line));
  if (!name) {
    const rem = phoneInfo.line.replace(phoneInfo.value, '').replace(/^(?:telephone|tel(?:ephone)?|phone|mobile|联系电话|电话|手机)\s*[:：]?/i, '').trim();
    if (rem && !/(?:address|地址)\s*[:：]/i.test(rem)) name = rem;
  }
  if (!address) address = remaining.find(line => /[省市区县路街号]|,/.test(line)) || '';
  if (!name) {
    const candidates = remaining.filter(line => line !== address && !countryFrom(line) && line.length <= 80 && !/[省市区县路街号]/.test(line));
    if (candidates.length === 1) name = candidates[0];
  }
  if (!name) throw new Error('未可靠识别姓名；可加 CONTACT/Name 标签，或在预览中填写。');
  if (!address) throw new Error('未可靠识别地址；可加 Address 标签，或在预览中填写。');
  const compact = address.replace(/\s/g, '');
  const country = countryFrom(`${address}\n${text}`) || (/^(内蒙古自治区|广西壮族自治区|宁夏回族自治区|新疆维吾尔自治区|西藏自治区|北京市|天津市|上海市|重庆市|[^省]{2,4}省)/.test(compact) ? 'CHINA' : '');
  if (!country) throw new Error('未识别国家。请写 Lao PDR、Vietnam、China 等国家英文名。');
  return { name, phone, country, ...(country === 'CHINA' ? splitChineseAddress(address.replace(/\bCHINA\b/ig, '')) : parseForeignAddress(address, country)) };
}
function romanizeItem(value) {
  let item = cleanText(value);
  for (const [re, output] of [[/ユリス錠/gi, 'YURISU TABLETS '], [/錠/gi, ' TABLETS '], [/カプセル/gi, ' CAPSULES '], [/散/gi, ' POWDER '], [/シロップ/gi, ' SYRUP ']]) item = item.replace(re, output);
  item = item.replace(/\s+/g, ' ').trim().toUpperCase();
  if (!item || !/^[\x20-\x7e]+$/.test(item)) throw new Error(`品名“${value}”无法可靠转换为英文，请手动填写英文申报名。`);
  return item;
}
function parsePackages(raw) {
  const lines = cleanText(raw).split('\n').filter(Boolean); if (!lines.length) throw new Error('请粘贴包裹清单。');
  return lines.map((line, index) => {
    const m = line.match(/^(.+?)\s+(\d+)\s*(?:盒|箱|个|件|pcs?|boxes?)\s+(\d+)\s*(?:JPY|円|日元)?$/i);
    if (!m) throw new Error(`第 ${index + 1} 行无法识别。格式：品名 500盒 2300`);
    const quantity = Number(m[2]), price = Number(m[3]), item = romanizeItem(m[1]);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99999) throw new Error(`第 ${index + 1} 行数量无效。`);
    if (!Number.isSafeInteger(price) || price < 1 || !Number.isSafeInteger(quantity * price)) throw new Error(`第 ${index + 1} 行价格无效。`);
    return { sourceName: m[1].trim(), item, quantity, price, total: quantity * price, parcelNo: index + 1, parcelTotal: lines.length };
  });
}
function validateOrder(order) {
  const r = order.recipient || {};
  for (const [key, label, max] of [['name','姓名',80],['phone','电话',20],['city','城市／地区',36],['address2','详细地址',80]]) {
    if (!String(r[key] || '').trim()) throw new Error(`请填写${label}。`); if (String(r[key]).length > max) throw new Error(`${label}超过 ${max} 字符限制。`);
  }
  if (String(r.province || '').length > 30 || String(r.address1 || '').length > 80) throw new Error('省份或地址1超过网站字符限制。');
  normalizePhone(r.phone); if (!r.country) throw new Error('请选择国家。');
  if (!['CGM','GENTLE'].includes(order.sender)) throw new Error('请选择寄件人。');
  if (!String(order.item || '').trim() || !/^[\x20-\x7e]+$/.test(order.item)) throw new Error('请用英文填写品名。');
  if (!Number.isSafeInteger(order.price) || order.price <= 0) throw new Error('单价应为正整数日元。');
  if (!Number.isSafeInteger(order.quantity) || order.quantity <= 0 || order.quantity > 99999) throw new Error('数量应为 1～99999。');
  if (!Number.isSafeInteger(order.price * order.quantity)) throw new Error('申报总额超出范围。');
  if (order.parcelTotal && (!Number.isSafeInteger(order.parcelNo) || order.parcelNo < 1 || order.parcelNo > order.parcelTotal)) throw new Error('包裹编号无效。');
  return order.price * order.quantity;
}
function fileName(tracking) { if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(tracking)) throw new Error('未识别到有效运单号。'); return `${tracking}.pdf`; }


  // A browser can briefly run an older userscript during an update. Keep only
  // the newest panel so its state and actions cannot conflict with the old one.
  document.getElementById('ems-helper-panel')?.remove();

  const SETTINGS_KEY = 'ems-helper.settings.v2';
  const SESSION_KEY = 'ems-helper.session.v2';
  const DEFAULTS = { sender: 'CGM', item: '', price: '', quantity: '', category: '', payment: '' };
  const EMPTY_RECIPIENT = { name: '', phone: '', country: 'CHINA', province: '', city: '', address1: '', address2: '', postal: '' };
  const readJSON = (storage, key, fallback) => { try { return JSON.parse(storage.getItem(key)) || fallback; } catch { return fallback; } };
  const prefs = { ...DEFAULTS, ...readJSON(localStorage, SETTINGS_KEY, {}) };
  let state = readJSON(sessionStorage, SESSION_KEY, null) || {
    order: { ...prefs, parcelNo: 1, parcelTotal: 1, recipient: { ...EMPTY_RECIPIENT }, raw: '' }, packages: [], packageIndex: 0, packagesRaw: '', phase: 'idle', agreed: true, lastAction: '', status: ''
  };
  state.packages ||= []; state.packageIndex ||= 0; state.packagesRaw ||= '';
  let busy = false;
  let cancelled = false;
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
  const isVisible = el => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0;
  const pageTitle = () => norm(document.querySelector('h2')?.textContent);
  const persist = () => sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  const textOf = el => norm(el.textContent);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(test, label, timeout = 8000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (cancelled) throw new Error('已暂停。');
      const value = test();
      if (value) return value;
      await pause(120);
    }
    throw new Error(`等待${label}超时；已停止，请检查网页。`);
  }
  function caption(el) {
    return norm(el.getAttribute('aria-label') || el.getAttribute('alt') ||
      (el.tagName === 'INPUT' ? el.value : '') || el.querySelector('img')?.alt || el.textContent);
  }
  function buttons(label) {
    return [...document.querySelectorAll('button,input[type=button],input[type=submit],input[type=image],a')]
      .filter(el => isVisible(el) && !el.disabled && caption(el) === label);
  }
  function button(label, last = false) {
    const all = buttons(label);
    if (!all.length) throw new Error(`未找到可操作的“${label}”，请检查当前页面。`);
    return last ? all[all.length - 1] : all[0];
  }
  function setValue(el, value) {
    if (!el || !isVisible(el) || el.disabled) throw new Error('目标输入框不可用，已停止。');
    const prototype = el.tagName === 'SELECT' ? HTMLSelectElement.prototype :
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) throw new Error('无法写入该输入框。');
    setter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }
  function inputIn(el) {
    return [...el.querySelectorAll('input:not([type]),input[type=text],input[type=number],textarea')].find(isVisible);
  }
  function leafRows() {
    return [...document.querySelectorAll('tr')].filter(tr => !tr.querySelector('tr') && isVisible(tr));
  }
  function fieldRow(label) {
    return [...document.querySelectorAll('tr')].filter(tr => [...tr.cells].some(cell =>
      ['TH', 'TD'].includes(cell.tagName) && norm(cell.textContent) === label))
      .sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0];
  }
  function selectByText(el, text) {
    if (!el) throw new Error(`找不到“${text}”的下拉框。`);
    const option = [...el.options].find(o => norm(o.textContent) === text);
    if (!option) throw new Error(`下拉框没有“${text}”选项。`);
    setValue(el, option.value);
  }
  function selectCountry(el, country) {
    if (!el) throw new Error('找不到国家下拉框。');
    const option = [...el.options].find(o => norm(o.textContent).startsWith(`${country}（`) || norm(o.textContent) === country);
    if (!option) throw new Error(`日本邮便的国家列表中没有“${country}”。`);
    setValue(el, option.value);
  }
  function setRadio(el) {
    if (!el || el.disabled || !isVisible(el)) throw new Error('选择项不可用。');
    if (!el.checked) el.click();
    if (!el.checked) throw new Error('选择项未选中。');
  }
  function controlText(el) {
    const labelled = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (labelled) return norm(labelled.textContent);
    const wrapped = el.closest('label');
    if (wrapped) return norm(wrapped.textContent);
    let text = ''; let next = el.nextSibling;
    while (next && !(next.nodeType === 1 && /^(INPUT|SELECT|BUTTON)$/.test(next.tagName))) { text += next.textContent || ''; next = next.nextSibling; }
    return norm(text);
  }
  function selectControlByTerms(terms) {
    const matches = text => terms.some(term => term.test(text));
    for (const control of [...document.querySelectorAll('input[type=radio],input[type=checkbox]')].filter(isVisible)) {
      if (matches(controlText(control))) { setRadio(control); return true; }
    }
    for (const select of [...document.querySelectorAll('select')].filter(isVisible)) {
      const option = [...select.options].find(o => matches(norm(o.textContent)));
      if (option) { setValue(select, option.value); return true; }
    }
    return false;
  }
  async function chooseFormalCustoms() {
    if (validateOrder(state.order) <= 200000) return;
    const expandRow = [...document.querySelectorAll('tr,div,td')].find(el => isVisible(el) && /(?:海关告知书|通関|报关)/.test(textOf(el)) && /(?:详细|詳細)/.test(textOf(el)) && el.querySelector('button,input[type=button]'));
    if (expandRow) {
      const expand = [...expandRow.querySelectorAll('button,input[type=button]')].find(el => caption(el) === '+');
      if (expand) { expand.click(); await pause(350); }
    }
    const automaticFormal = /(?:客户必须出口申报|通关委托的设定|通関委任)/.test(textOf(document.body));
    const formal = automaticFormal || selectControlByTerms([/需要.*(?:报关|通关|海关)/, /(?:报关|通関).*必要/, /正式.*报关/]);
    // Japan Post's actual declaration page puts the explanatory text after a
    // hidden input, so text-based label discovery cannot reliably reach it.
    // Prefer the stable field name used by that page.
    const exactDelegation = document.querySelector('input[type="checkbox"][name="shippingBean.ininFlg"]');
    const delegated = exactDelegation && isVisible(exactDelegation)
      ? (setRadio(exactDelegation), true)
      : selectControlByTerms([
      /委任给日本郵便株式会社的报关手续/, /委任给日本邮便株式会社的报关手续/,
      /(?:委托|委任).*(?:EMS|日本邮便|日本郵便)/, /(?:EMS|日本邮便|日本郵便).*(?:委托|委任)/
      ]);
    if (!formal || !delegated) throw new Error('本票超过 20 万日元，但未找到正式报关状态或“委任给日本邮便株式会社的报关手续”复选框。请检查通关委托设定。');
    state.order.customsFormal = true; state.order.customsDelegated = true; persist();
  }
  function status(message, error = false) {
    state.status = message;
    ui.status.textContent = message;
    ui.status.className = error ? 'status error' : 'status';
    persist();
  }
  function stop(message, error = false) {
    state.phase = 'idle';
    cancelled = true;
    status(message, error);
    updateActions();
  }
  function navigate(label, key, last = false) {
    const action = `${pageTitle()}|${key}`;
    if (state.lastAction === action) throw new Error('同一步骤已执行过，已暂停以避免重复提交。请检查页面后手动继续。');
    state.lastAction = action;
    persist();
    button(label, last).click();
  }
  function contentRows() {
    return leafRows().filter(tr => [...tr.querySelectorAll('button,input[type=button],input[type=submit],input[type=image]')]
      .some(el => caption(el) === '更改') && tr.querySelector('input') &&
      [...tr.cells].some(cell => /\bJPY\b/.test(textOf(cell)) || /\d+JPY/.test(textOf(cell))));
  }
  function registeredRow(order) {
    return contentRows().find(tr => norm(tr.cells[0]?.textContent) === norm(order.item) &&
      norm(tr.cells[1]?.textContent).replace(/\s+/g, '') === `${order.price}JPY`);
  }
  function entryRow() {
    const confirm = buttons('确认')[0];
    return confirm?.closest('tr');
  }
  function setTotal(total) {
    const row = fieldRow('内容物品总额 （请输入日元）') || [...document.querySelectorAll('tr')].find(tr =>
      [...tr.cells].some(c => c.tagName === 'TH' && textOf(c).replace(/\s/g, '').startsWith('内容物品总额')));
    if (!row) throw new Error('找不到内容物总额输入框。');
    const cells = [...row.cells];
    const index = cells.findIndex(c => textOf(c).replace(/\s/g, '').startsWith('内容物品总额'));
    setValue(inputIn(cells[index + 1]), total);
  }
  function selectCategory(category) {
    const row = fieldRow('内容物品种类');
    selectByText(row?.querySelector('select'), category);
  }
  async function fillRecipient() {
    const r = state.order.recipient;
    const country = [...document.querySelectorAll('select')].find(el => [...el.options].some(o => norm(o.textContent) === 'CHINA（中国）'));
    if (!country) throw new Error('未找到收件国家。');
    if (!norm(country.selectedOptions[0]?.textContent).startsWith(`${r.country}（`)) {
      selectCountry(country, r.country);
      await pause(500);
    }
    const values = { nam: r.name, companyName: '', postName: '', add1: r.address1, add2: r.address2,
      add3: r.city, pref: r.province, postal: r.postal, tel: r.phone, fax: '', mail: '' };
    for (const [name, value] of Object.entries(values)) {
      const field = document.getElementsByName(`addrToBean.${name}`)[0];
      setValue(field, value);
      if (field.value !== String(value)) throw new Error(`地址字段 ${name} 未写入，请手动检查。`);
    }
    status('收件人信息已填写，正在进入内容物页面。');
    navigate('下一页', 'recipient-next');
  }
  async function fillContents() {
    const order = state.order;
    button('EMS(物品)').click();
    await waitFor(() => entryRow(), '内容物输入栏');
    const existing = contentRows();
    let row = registeredRow(order);
    if (existing.length && (!row || existing.length !== 1)) {
      throw new Error('本页有其他内容物或不同单价，请先手动核对；脚本不会删除已有条目。');
    }
    if (!row) {
      const entry = entryRow();
      const cells = [...entry.cells];
      if (cells.length < 5) throw new Error('内容物表格结构改变，已停止。');
      setValue(inputIn(cells[0]), order.item);
      setValue(inputIn(cells[1]), order.price);
      selectByText(cells[1].querySelector('select'), 'JPY/日元');
      setValue(inputIn(cells[3]), order.quantity);
      state.lastAction = '';
      persist();
      button('确认').click();
      row = await waitFor(() => registeredRow(order), '已添加的内容物');
    }
    setValue(inputIn(row.cells[3]), order.quantity);
    selectCategory(order.category);
    setTotal(validateOrder(order));
    if (!state.agreed) throw new Error('请先确认本票内容物及危险物品声明。');
    const check = [...document.querySelectorAll('input[type=checkbox]')].find(el =>
      isVisible(el) && /已确认不存在/.test(el.closest('td')?.textContent || el.parentElement.textContent));
    setRadio(check);
    status('内容物和总额已填写，正在进入寄送信息页。');
    navigate('下一页', 'contents-next');
  }
  function selectSender() {
    const desired = state.order.sender === 'CGM' ? 'CGM INNOVATION CO.LTD.' : 'Gentle General Medicine Clinic';
    const rows = leafRows().filter(tr => tr.querySelector('input[type=radio]') && textOf(tr).includes(desired));
    if (rows.length !== 1) throw new Error('常用寄件人没有唯一匹配，请在网站中手动选择。');
    setRadio(rows[0].querySelector('input[type=radio]'));
    navigate('下一页', 'sender-next', true);
  }
  async function fillShipping() {
    if (state.order.parcelTotal > 1) {
      const numberRow = fieldRow('号码／总个数');
      const inputs = [...(numberRow?.querySelectorAll('input[type=text]') || [])].filter(isVisible);
      if (inputs.length !== 2) throw new Error('未找到包裹号码／总个数的两个输入框。');
      setValue(inputs[0], state.order.parcelNo);
      setValue(inputs[1], state.order.parcelTotal);
    }
    const row = fieldRow('付款条件');
    const radio = [...(row?.querySelectorAll('input[type=radio]') || [])].find(el => {
      const label = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (norm(label?.textContent) === state.order.payment) return true;
      let next = el.nextSibling;
      let text = '';
      while (next && !(next.nodeType === 1 && next.matches('input[type=radio]'))) {
        text += next.textContent || '';
        next = next.nextSibling;
      }
      return norm(text).startsWith(state.order.payment);
    });
    if (!radio) throw new Error('未识别到付款条件，请在网页中手动选择后继续。');
    setRadio(radio);
    await chooseFormalCustoms();
    // Weight and postage remain blank unless the user filled them on the website.
    // Japan Post's verified workflow permits the postal counter to weigh and price the parcel.
    navigate('下一页', 'shipping-next');
  }
  function verifyReview() {
    const order = state.order;
    const cells = [...document.querySelectorAll('td')];
    const sender = cells.find(td => !td.querySelector('td') && /寄件人/.test(td.textContent) && /JAPAN/.test(td.textContent));
    const expectedSender = order.sender === 'CGM' ? 'CGM INNOVATION CO.LTD.' : 'Gentle General Medicine Clinic';
    if (!sender || !textOf(sender).includes(expectedSender)) throw new Error('确认页寄件人与预设不一致，请检查。');
    const recipient = cells.find(td => !td.querySelector('td') && /收件人/.test(td.textContent));
    const compact = value => String(value).replace(/\s+/g, '');
    if (!recipient || ['name','phone','province','city','address1','address2','postal'].some(k =>
      order.recipient[k] && !compact(recipient.textContent).includes(compact(order.recipient[k])))) {
      throw new Error('确认页收件信息与预览不一致，请检查。');
    }
    if (!leafRows().some(tr => {
      const c = [...tr.cells];
      return c.length === 4 && textOf(c[0]) === norm(order.item) &&
        textOf(c[2]).replace(/\s/g, '') === `${order.price}JPY` && textOf(c[3]) === String(order.quantity);
    })) throw new Error('确认页内容物、单价或数量不一致，请检查。');
    const totalRow = fieldRow('内容物品总额');
    if (!totalRow || !textOf(totalRow).replace(/\s/g, '').includes(`${validateOrder(order)}日元`) || !textOf(totalRow).includes(order.category)) {
      throw new Error('确认页总额或类别不一致，请检查。');
    }
    if (!textOf(fieldRow('付款条件') || document.createElement('span')).includes(order.payment)) throw new Error('付款条件与预设不一致。');
    if (order.parcelTotal > 1) {
      const numberRow = fieldRow('号码／总个数');
      const compactNumber = textOf(numberRow || document.createElement('span')).replace(/\s/g, '');
      if (!compactNumber.includes(`${order.parcelNo}／${order.parcelTotal}`)) throw new Error(`确认页包裹编号不是 ${order.parcelNo}/${order.parcelTotal}。`);
    }
    if (validateOrder(order) > 200000 && (!order.customsFormal || !order.customsDelegated) && /委任.*日本[郵邮]便.*报关手续/.test(textOf(document.body))) {
      order.customsFormal = true; order.customsDelegated = true; persist();
    }
    if (validateOrder(order) > 200000 && (!order.customsFormal || !order.customsDelegated)) {
      throw new Error('本票应选择需要报关手续及委托 EMS 报关，但确认状态未记录。');
    }
  }
  function pdfFrame() {
    return [...document.querySelectorAll('iframe')].find(frame => {
      try { const url = new URL(frame.getAttribute('src'), location.href); return url.origin === location.origin && /\/DOWNLOAD$/i.test(url.pathname) && url.searchParams.has('pdf'); }
      catch { return false; }
    });
  }
  function trackingNumber() {
    return document.body.innerText.match(/\b[A-Z]{2}\d{9}JP\b/)?.[0];
  }
  async function downloadPDF() {
    const frame = pdfFrame();
    if (!frame) throw new Error('PDF 尚未生成；请等待网页加载。');
    const tracking = trackingNumber();
    const filename = fileName(tracking || '');
    const url = new URL(frame.getAttribute('src'), location.href);
    if (url.origin !== location.origin) throw new Error('PDF 地址不属于日本邮便本站，已停止。');
    status(`正在下载 ${filename}…`);
    const response = await fetch(url.href, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error(`PDF 下载失败（HTTP ${response.status}），请使用网页内 PDF 阅读器下载。`);
    const blob = await response.blob();
    const first = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...first) !== '%PDF-') throw new Error('网站返回的内容不是 PDF，可能登录已过期；请用网页阅读器下载。');
    const objectURL = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = objectURL; link.download = filename;
    link.style.display = 'none'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectURL), 60000);
    state.phase = 'done'; state.tracking = tracking; state.registrationPending = false;
    const hasNext = state.packages.length && state.packageIndex < state.packages.length - 1;
    if (hasNext) {
      state.packageIndex += 1;
      Object.assign(state.order, state.packages[state.packageIndex]);
      state.order.recipient ||= { ...EMPTY_RECIPIENT };
    } else if (!state.packages.length) state.order = { ...prefs, recipient: { ...EMPTY_RECIPIENT }, raw: '' };
    state.agreed = true;
    syncForm();
    const next = hasNext ? ` 下一票已载入：${state.packageIndex + 1}/${state.packages.length}。打印完毕返回菜单后核对并开始。` : '';
    status(`已触发下载：${filename}。保存到浏览器的“下载”文件夹。${next}`);
    if (hasNext) {
      status(`已触发下载：${filename}。下一票 ${state.packageIndex + 1}/${state.packages.length} 正在自动继续。`);
      setTimeout(() => { cancelled = false; advance(); }, 600);
    }
    updateActions();
  }
  async function advance() {
    if (busy || !['fill', 'generate'].includes(state.phase)) return;
    busy = true; cancelled = false;
    try {
      if (state.phase === 'fill') {
        validateOrder(state.order);
        switch (pageTitle()) {
          case '我的主页菜单': navigate('生成发货单', 'menu-start'); break;
          case '选择寄件人': selectSender(); break;
          case '选择收件人': navigate('收件人信息的输入', 'recipient-input'); break;
          case '收件人信息输入': await fillRecipient(); break;
          case '内容物品登录': await fillContents(); break;
          case '发送关联信息登录': await fillShipping(); break;
          case '登录内容的确认':
            verifyReview(); state.phase = 'review';
            status('填写完成。请核对网站确认页，再点“确认并生成 PDF”。'); updateActions(); break;
          default: throw new Error('当前页不在自动填单流程中。请回到菜单／寄件人选择页后开始。');
        }
      } else {
        if (pageTitle() === '登录内容的确认') {
          throw new Error('已发送生成请求但页面仍在确认页。为避免重复运单，不会自动重试；请先检查网站。');
        }
        if (buttons('注意事项同意后打印发货单').length) {
          navigate('注意事项同意后打印发货单', 'print');
        } else if (pdfFrame()) {
          await downloadPDF();
        } else throw new Error('等待打印页时遇到未知页面，请检查网站。');
      }
    } catch (error) {
      stop(error.message || String(error), true);
    } finally { busy = false; }
  }

  const host = document.createElement('div');
  host.id = 'ems-helper-panel';
  document.documentElement.append(host);
  // If a stale copy is injected after this script, remove that duplicate and
  // keep this version's panel and state authoritative.
  new MutationObserver(() => {
    document.querySelectorAll('#ems-helper-panel').forEach(panel => { if (panel !== host) panel.remove(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host{position:fixed;right:16px;top:74px;width:350px;z-index:2147483000;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;color:#18324d}
      *{box-sizing:border-box} .panel{display:flex;flex-direction:column;max-height:calc(100vh - 90px);background:#fff;border:1px solid #c9d7e6;border-radius:12px;box-shadow:0 8px 32px #18324d24;overflow:hidden}
      header{display:flex;flex-shrink:0;align-items:center;justify-content:space-between;padding:11px 14px;background:#123d65;color:white}header strong{font-size:15px}.version{font-size:11px;font-weight:400;margin-left:6px;color:#d0e8ff}header button{background:transparent;color:white;border:0;padding:0 5px;font-size:20px;cursor:pointer}
      main{padding:12px;min-height:0;overflow:auto;flex:1}footer{flex-shrink:0;padding:8px 12px 10px;border-top:1px solid #dce5ee;background:#fff}footer .actions{margin:7px 0 0}footer .status{margin:0;max-height:88px;overflow:auto}#generate{width:100%}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.full{grid-column:1/-1}
      label{display:block;font-size:12px;color:#375470}input,select,textarea{display:block;width:100%;border:1px solid #bacbdb;border-radius:6px;padding:7px;margin-top:3px;font:13px/1.4 inherit;color:#18324d;background:#fff}textarea{resize:vertical;min-height:78px}
      input:focus,select:focus,textarea:focus{outline:2px solid #6da4d4;outline-offset:1px}button.action{border:1px solid #b7cada;border-radius:6px;padding:8px 10px;background:#edf3f8;color:#18324d;cursor:pointer;font-weight:600}button.primary{background:#12619a;border-color:#12619a;color:white}button:disabled{opacity:.45;cursor:default}
      .actions{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.hint{color:#60768b;font-size:11px;margin:7px 0}.total{margin:9px 0;padding:8px;background:#edf5fc;border-radius:6px;font-weight:600}.status{white-space:pre-wrap;margin-top:9px;padding:8px;border-radius:6px;background:#f1f5f8;font-size:12px}.error{background:#fff0ed;color:#9f3527}.check{display:flex;gap:7px;margin:9px 0;align-items:flex-start}.check input{width:auto;margin-top:4px}.check span{font-size:11px}details{margin-top:8px}summary{cursor:pointer;font-weight:600;margin-bottom:8px}.queue{font-size:11px;background:#f6f8fa;border:1px solid #d9e2eb;border-radius:6px;padding:6px;margin-top:6px;white-space:pre-wrap}.hidden{display:none!important}
    </style>
    <section class="panel"><header><strong>EMS 制单助手 <span class="version">v2.0.12</span></strong><button id="collapse" title="收起／展开">−</button></header><main id="main">
      <label>粘贴收件信息（顺序不限；国外建议用 Address / CONTACT / Telephone）<textarea id="raw" placeholder="Address: Chommany Village, Xaysettha District, Vientiane Capital, Lao PDR&#10;CONTACT: Xonthichack RATTANA(TR)&#10;Telephone: 00856 20 88782889"></textarea></label>
      <div class="actions"><button class="action" id="parse">识别地址</button><button class="action" id="clear">清空地址</button></div>
      <details open><summary>收件信息预览</summary><div class="grid">
        <label>姓名<input id="name"></label><label>手机<input id="phone" inputmode="tel"></label>
        <label>省／自治区<input id="province"></label><label>市／区／县<input id="city"></label>
        <label class="full">详细地址／街道<input id="address2"></label>
        <label class="full">小区／楼栋／房间<input id="address1"></label>
        <label>邮编（可留空）<input id="postal" inputmode="numeric"></label><label>国家<select id="country"><option>CHINA</option><option>LAOS</option><option>VIET NAM</option><option>THAILAND</option><option>CAMBODIA</option><option>MALAYSIA</option><option>SINGAPORE</option><option>PHILIPPINES</option><option>INDONESIA</option><option>KOREA</option><option>TAIWAN</option><option>HONG KONG</option><option>MACAO</option><option>AUSTRALIA</option><option>CANADA</option><option>UNITED STATES OF AMERICA</option><option>UNITED KINGDOM</option></select></label>
      </div></details>
      <details open><summary>包裹队列（一行一个包裹）</summary>
        <label>格式：品名 数量 单价（日元）<textarea id="packages-raw" placeholder="ユリス錠0.5mg 500盒 2300&#10;ユリス錠1mg 500盒 4300&#10;ユリス錠2mg 500盒 7400"></textarea></label>
        <div class="actions"><button class="action" id="parse-packages">建立包裹队列</button><select id="package-select" aria-label="当前包裹"></select></div>
        <div id="queue" class="queue">尚未建立队列；可继续使用下方单包裹设置。</div>
      </details>
      <details open><summary>寄件与申报</summary><div class="grid">
        <label class="full">寄件人<select id="sender"><option value="CGM">CGM INNOVATION CO.LTD.</option><option value="GENTLE">Gentle General Medicine Clinic</option></select></label>
        <label class="full">英文品名<input id="item"></label>
        <label>单价（日元）<input id="price" type="number" min="1" step="1"></label><label>数量<input id="quantity" type="number" min="1" max="99999" step="1"></label>
        <label>类别<select id="category"><option value=""></option><option>礼品</option><option>电子商务商品</option><option>商业商品(B2B)</option><option>退件</option><option>其他</option></select></label>
        <label>付款条件<select id="payment"><option value=""></option><option>无商业价值</option><option>有商业价值</option></select></label>
      </div><div id="total" class="total"></div><div id="parcel-number" class="hint"></div><button class="action" id="save-defaults">保存为默认值</button></details>
      <div class="hint">重量和邮费在网站上按实际情况填写。PDF 保存到浏览器下载位置；本助手不改变 Chrome 设置。</div>
    </main><footer id="footer">
      <div id="status" class="status" aria-live="polite"></div>
      <label class="check"><input type="checkbox" id="agree"><span>本票地址、品名、数量及价值与实物一致；无页面所列危险物品，同意日本邮便在怀疑时开包检查。</span></label>
      <div class="actions"><button class="action primary" id="start">开始自动填单</button><button class="action" id="stop">暂停</button></div>
      <div class="actions"><button class="action primary hidden" id="generate">确认并生成 PDF</button><button class="action hidden" id="download">下载当前 PDF</button></div>
    </footer></section>`;
  const $ = id => shadow.getElementById(id);
  const ui = { status: $('status') };
  function syncForm() {
    for (const key of Object.keys(EMPTY_RECIPIENT)) $(key).value = state.order.recipient[key] || '';
    for (const key of Object.keys(DEFAULTS)) $(key).value = state.order[key] ?? DEFAULTS[key];
    $('raw').value = state.order.raw || '';
    $('packages-raw').value = state.packagesRaw || '';
    $('agree').checked = !!state.agreed;
    renderQueue();
    updateTotal();
  }
  function readForm() {
    const recipient = {};
    for (const key of Object.keys(EMPTY_RECIPIENT)) recipient[key] = $(key).value.trim();
    const parcelNo = state.order.parcelNo || 1, parcelTotal = state.order.parcelTotal || 1;
    const customsFormal = state.order.customsFormal, customsDelegated = state.order.customsDelegated;
    state.order = { recipient, raw: $('raw').value, parcelNo, parcelTotal, customsFormal, customsDelegated };
    for (const key of Object.keys(DEFAULTS)) state.order[key] = ['price','quantity'].includes(key) ? Number($(key).value) : $(key).value.trim();
    state.packagesRaw = $('packages-raw').value;
    state.agreed = $('agree').checked;
    persist(); updateTotal();
  }
  function applyPackage(index) {
    if (!state.packages[index]) throw new Error('包裹编号不存在。');
    state.packageIndex = index;
    Object.assign(state.order, state.packages[index]);
    state.agreed = true; persist(); syncForm();
  }
  function renderQueue() {
    const select = $('package-select'); select.innerHTML = '';
    if (!state.packages.length) {
      $('queue').textContent = '尚未建立队列；可继续使用下方单包裹设置。';
      $('parcel-number').textContent = '单包裹'; return;
    }
    state.packages.forEach((p, i) => {
      const option = document.createElement('option'); option.value = String(i); option.textContent = `${i + 1}/${state.packages.length} ${p.item}`; select.append(option);
    });
    select.value = String(state.packageIndex);
    $('queue').textContent = state.packages.map((p, i) => `${i + 1}/${state.packages.length}  ${p.item}  ${p.quantity} × ¥${p.price} = ¥${p.total.toLocaleString('zh-CN')}`).join('\n');
    $('parcel-number').textContent = `当前包裹编号：${state.order.parcelNo} / ${state.order.parcelTotal}`;
  }
  function updateTotal() {
    const total = Number($('price').value) * Number($('quantity').value);
    $('total').textContent = Number.isFinite(total) && total > 0 ? `申报合计：${total.toLocaleString('zh-CN')} 日元` : '请填写有效单价和数量';
  }
  function updateActions() {
    const reviewing = pageTitle() === '登录内容的确认';
    $('generate').classList.toggle('hidden', !reviewing);
    $('start').classList.toggle('hidden', reviewing);
    $('download').classList.toggle('hidden', !pdfFrame());
    $('start').disabled = ['fill', 'generate'].includes(state.phase);
    $('generate').disabled = state.phase === 'generate' || !!state.registrationPending;
  }
  function runSafely(fn) { return async () => { try { await fn(); } catch (error) { stop(error.message || String(error), true); } }; }
  $('collapse').onclick = () => { const hidden = $('main').classList.toggle('hidden'); $('footer').classList.toggle('hidden', hidden); $('collapse').textContent = hidden ? '+' : '−'; };
  $('parse').onclick = runSafely(() => {
    readForm(); state.order.recipient = parseAddress(state.order.raw); state.agreed = true;
    syncForm(); status('地址已拆分，请核对预览。');
  });
  $('parse-packages').onclick = runSafely(() => {
    readForm(); state.packages = parsePackages(state.packagesRaw); state.packageIndex = 0;
    Object.assign(state.order, state.packages[0]); state.agreed = true; syncForm();
    status(`已建立 ${state.packages.length} 个包裹。第三列按“单价”计算；请逐票核对申报总额。`);
  });
  $('package-select').onchange = () => applyPackage(Number($('package-select').value));
  $('clear').onclick = () => {
    state.phase = 'idle'; cancelled = true; state.lastAction = '';
    state.order.recipient = { ...EMPTY_RECIPIENT }; state.order.raw = ''; state.order.parcelNo = 1; state.order.parcelTotal = 1;
    state.packages = []; state.packageIndex = 0; state.packagesRaw = ''; state.agreed = true;
    syncForm(); status('本页地址草稿已清空；网站上的表单未被清除。'); updateActions();
  };
  $('save-defaults').onclick = runSafely(() => {
    readForm(); const settings = {};
    for (const key of Object.keys(DEFAULTS)) settings[key] = state.order[key];
    if (!Number.isInteger(settings.price) || settings.price <= 0 || !Number.isInteger(settings.quantity) || settings.quantity < 1 || settings.quantity > 999 || !settings.item) throw new Error('请检查默认品名、单价和数量。');
    Object.assign(prefs, settings); localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    status('默认寄件人和申报值已保存在本机；每票可修改。收件人资料不会保存为默认值。');
  });
  $('start').onclick = runSafely(async () => {
    readForm();
    if (!state.order.recipient.name && state.order.raw) { state.order.recipient = parseAddress(state.order.raw); syncForm(); }
    validateOrder(state.order);
    if (!state.agreed) throw new Error('请核对本票数据并勾选声明，然后开始。');
    if (['我的主页菜单', '选择寄件人'].includes(pageTitle())) state.registrationPending = false;
    if (state.registrationPending) throw new Error('之前已发出生成运单请求。请先检查发送预定数据，避免重复制单。');
    state.phase = 'fill'; state.lastAction = ''; cancelled = false;
    status('开始填写。遇到不匹配的页面会停止。'); updateActions(); await advance();
  });
  $('stop').onclick = () => stop('已暂停。可以修改后继续，或直接操作网站。');
  $('generate').onclick = runSafely(() => {
    readForm(); validateOrder(state.order); verifyReview();
    if (!state.agreed) throw new Error('请确认本票数据及危险物品声明。');
    if (state.phase === 'generate' || state.registrationPending) throw new Error('生成请求已经发出，请勿重复点击。');
    state.phase = 'generate'; state.registrationPending = true; state.lastAction = ''; cancelled = false;
    status('正在生成运单，请勿重复点击；成功后自动下载 PDF。'); updateActions();
    navigate('登录发货单', 'register');
  });
  $('download').onclick = runSafely(async () => { if (busy) return; busy = true; try { await downloadPDF(); } finally { busy = false; } });
  shadow.addEventListener('change', event => {
    if (event.target.matches('input,select,textarea')) {
      if (['fill', 'generate'].includes(state.phase)) stop('已暂停，修改后请重新开始。');
      if (event.target.id !== 'agree' && state.phase !== 'fill') $('agree').checked = false;
      readForm();
    }
  });
  syncForm();
  ui.status.textContent = state.status || '粘贴收件地址后点击“识别地址”。默认：CGM／calcium／1,200 日元 × 2／礼品／无商业价值。';
  updateActions();
  /* TEST_HOOK */
  if (['fill', 'generate'].includes(state.phase)) setTimeout(advance, 400);

  // v2.0.13: the item-entry screen is dynamically rebuilt by Japan Post.
  // Keep the helper mounted when that rebuild removes its host node.
  const resilientHost = document.getElementById('ems-helper-panel');
  if (resilientHost) new MutationObserver(() => {
    if (!resilientHost.isConnected) document.documentElement.append(resilientHost);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // A package may contain several medicines. PACKAGE / ?? headings group
  // subsequent item lines; without a heading, each line remains one parcel.
  const baseParsePackages = parsePackages;
  parsePackages = raw => {
    const sourceLines = String(raw || '').replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
    const groups = []; let current = null; let grouped = false;
    for (const line of sourceLines) {
      if (/^(?:PACKAGE|PARCEL|\u5305\u88f9)\s*\d*\s*[:\uff1a]?$/i.test(line)) {
        current = []; groups.push(current); grouped = true; continue;
      }
      const itemLine = line.replace(/\s*(?:\u4e00\u4e2a\u5305\u88f9|ONE\s+PARCEL)\s*$/i, '').trim();
      const parsed = baseParsePackages(itemLine)[0];
      if (grouped) current.push(parsed); else groups.push([parsed]);
    }
    if (!groups.length || groups.some(group => !group.length)) throw new Error('Each package needs at least one item.');
    return groups.map((items, index) => ({ ...items[0], items, total: items.reduce((sum, item) => sum + item.total, 0), parcelNo: index + 1, parcelTotal: groups.length }));
  };
  const baseValidateOrder = validateOrder;
  validateOrder = order => {
    const items = Array.isArray(order.items) && order.items.length ? order.items : [order];
    return items.reduce((sum, item) => sum + baseValidateOrder({ ...order, ...item, items: undefined }), 0);
  };
  fillContents = async function () {
    const order = state.order;
    const items = Array.isArray(order.items) && order.items.length ? order.items : [order];
    button('EMS(\u7269\u54c1)').click();
    await waitFor(() => entryRow(), 'item entry');
    const existing = contentRows();
    const matches = new Map(items.map(item => [item.item + '|' + item.price, registeredRow(item)]));
    if (existing.some(row => !items.some(item => row === registeredRow(item)))) throw new Error('Existing items do not match this package.');
    for (const item of items) {
      let row = matches.get(item.item + '|' + item.price);
      if (!row) {
        const entry = entryRow(); const cells = [...entry.cells];
        if (cells.length < 5) throw new Error('Item entry layout was not recognized.');
        setValue(inputIn(cells[0]), item.item);
        setValue(inputIn(cells[1]), item.price);
        selectByText(cells[1].querySelector('select'), 'JPY/\u65e5\u5143');
        setValue(inputIn(cells[3]), item.quantity);
        state.lastAction = ''; persist(); button('\u786e\u8ba4').click();
        row = await waitFor(() => registeredRow(item), 'registered item');
      }
      setValue(inputIn(row.cells[3]), item.quantity);
    }
    selectCategory(order.category); setTotal(validateOrder(order));
    if (!state.agreed) throw new Error('Please confirm the declaration.');
    const check = [...document.querySelectorAll('input[type=checkbox]')].find(el => isVisible(el) && /\u5df2\u786e\u8ba4\u4e0d\u5b58\u5728\u4e0a\u8ff0\u8bb0\u8f7d/.test(el.closest('td')?.textContent || el.parentElement.textContent));
    setRadio(check);
    status('Items completed.'); navigate('\u4e0b\u4e00\u9875', 'contents-next');
  };
  const quickCalcium = document.createElement('button');
  quickCalcium.className = 'action'; quickCalcium.id = 'quick-calcium'; quickCalcium.textContent = '\u9ed8\u8ba4\uff1a\u5355\u5305\u9499\u7247';
  $('parse').parentElement.append(quickCalcium);
  quickCalcium.onclick = runSafely(() => {
    readForm(); state.packages = []; state.packageIndex = 0; state.packagesRaw = '';
    Object.assign(state.order, { item: 'calcium', price: 1200, quantity: 2, category: '\u793c\u54c1', payment: '\u73b0\u91d1\u652f\u4ed8', parcelNo: 1, parcelTotal: 1, items: [{ item: 'calcium', price: 1200, quantity: 2, total: 2400 }] });
    state.agreed = true; persist(); syncForm(); status('Default calcium parcel loaded.');
  });

})();
