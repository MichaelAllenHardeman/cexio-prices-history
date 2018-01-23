
const fs            = require ('fs');
const child_process = require ('child_process');
const http          = require ('http');
const https         = require ('https');

if (!Promise.sequence) {
  Promise.sequence = funcs => funcs.reduce ((promise, func) => promise.then (result => func().then (Array.prototype.concat.bind (result))), Promise.resolve ([]));
}

const API_OPTIONS = {
  protocol: 'https:',
  hostname: 'cex.io',
  path: '/api/ohlcv/hd/'
};
const DATA_FOLDER          = __dirname + '/data/';
const HISTORIES_FOLDER     = DATA_FOLDER + 'histories/';
const CURRENCY_LIMITS_CMD  = 'node get-currency-limits.js';
const CURRENCY_LIMITS_FILE = DATA_FOLDER + 'currency-limits.json';
const TIMEOUT              = 100;
const PARALLEL_DAYS        = false;
const PARALLEL_MONTHS      = false;
const PARALLEL_YEARS       = false;
const PARALLEL_PAIRS       = false;

const COIN_BLACK_LIST = [
//'USD', // United States Dollar
  'EUR', // Euro Dollar
  'GBP', // Great British Pound
  'RUB', // Russian Ruble
  'GHS'  // Ghanaian Credi
];

function midnight (date) {
  let copied = new Date (date.getTime ());
  copied.setMilliseconds (0);
  copied.setMinutes (0);
  copied.setHours (0);
  return copied;
}

function startOfMonth (date) {
  let copied = new Date(date.getTime ());
  copied.setDate (1);
  return copied;
}

function endOfMonth (date) {
  let copied = new Date (date.getTime ());
  copied.setMonth (copied.getMonth() + 1);
  copied.setDate (0);
  return copied;
}

function startOfYear (date) {
  let copied = new Date (date.getTime ());
  copied.setMonth (0);
  copied.setDate (1);
  return copied;
}

function endOfYear (date) {
  let copied = new Date (date.getTime ());
  copied.setMonth (12);
  copied.setDate (0);
  return copied;
}

function toDate (dateString) {
  let output = midnight(new Date());
  output.setYear  (parseInt (dateString.substring (0, 4)));
  output.setMonth (parseInt (dateString.substring (4, 6)) - 1);
  output.setDate  (parseInt (dateString.substring (6, 8)));
  return output;
}

const COIN_PAIR_START_DATES = [
  { symbol1: 'BCH',  symbol2: 'BTC', start: toDate('20170803') },
  { symbol1: 'BCH',  symbol2: 'EUR', start: toDate('20170803') },
  { symbol1: 'BCH',  symbol2: 'GBP', start: toDate('20170804') },
  { symbol1: 'BCH',  symbol2: 'USD', start: toDate('20170803') },

  { symbol1: 'BTC',  symbol2: 'EUR', start: toDate('20140718') },
  { symbol1: 'BTC',  symbol2: 'GBP', start: toDate('20161228') },
  { symbol1: 'BTC',  symbol2: 'RUB', start: toDate('20150923') },
  { symbol1: 'BTC',  symbol2: 'USD', start: toDate('20140718') },

  { symbol1: 'DASH', symbol2: 'BTC', start: toDate('20170914') },
  { symbol1: 'DASH', symbol2: 'EUR', start: toDate('20170914') },
  { symbol1: 'DASH', symbol2: 'GBP', start: toDate('20170915') },
  { symbol1: 'DASH', symbol2: 'USD', start: toDate('20170914') },

  { symbol1: 'ETH',  symbol2: 'BTC', start: toDate('20160413') },
  { symbol1: 'ETH',  symbol2: 'EUR', start: toDate('20160601') },
  { symbol1: 'ETH',  symbol2: 'GBP', start: toDate('20170619') },
  { symbol1: 'ETH',  symbol2: 'USD', start: toDate('20160413') },

  { symbol1: 'GHS',  symbol2: 'BTC', start: toDate('20140324') },

  { symbol1: 'ZEC',  symbol2: 'BTC', start: toDate('20170928') },
  { symbol1: 'ZEC',  symbol2: 'EUR', start: toDate('20170928') },
  { symbol1: 'ZEC',  symbol2: 'GBP', start: toDate('20170928') },
  { symbol1: 'ZEC',  symbol2: 'USD', start: toDate('20170928') }
];

function getCoinPairStart (symbol1, symbol2) {
  return COIN_PAIR_START_DATES.find ((pair) => pair.symbol1 === symbol1 && pair.symbol2 === symbol2).start;
}

function stepDays   (date) { date.setDate  (date.getDate     () + 1); }
function stepMonths (date) { date.setMonth (date.getMonth    () + 1); }
function stepYears  (date) { date.setYear  (date.getFullYear () + 1); }

function getDatesBetween (start, end, step) {
  if (start > end) { return getDatesBetween (end, start); }
  let output = [];
  let copied = new Date (start.getTime());
  while (copied.getTime() <= end.getTime()) {
    output.push (new Date (copied.getTime()));
    step (copied);
  }
  return output;
}

function maybeCreateFolder (folder) {
  if (fs.existsSync (folder)) { return; }
  fs.mkdirSync(folder);
}

function fileExists (file) { return ; }

function writeFile (result) {
  fs.writeFileSync(result.file, JSON.stringify (result.data, null, 2));
}

function ensureDigits (number, digits) {
  return number.toLocaleString('en-US', {minimumIntegerDigits: digits, useGrouping:false});
}

function getDateString (date) {
  return String (date.getFullYear ())
    .concat (ensureDigits ((date.getMonth () + 1), 2))
    .concat (ensureDigits  (date.getDate  (),      2));
}

function request (options, callback) {
  let protocol = options.protocol === 'https:' ? https : http;
  let request  = protocol.request (options, function (response) {
    let output = '';
    response.setEncoding ('utf8');
    response.on ('data', (chunk) => { output += chunk; });
    response.on ('end',  ()      => { callback (null, response, JSON.parse(output)); });
  });
  request.on ('error', (error) => { callback (error, null, null); });
  request.end();
};

function getDay (symbol1, symbol2, start, folder) {
  return new Promise ((resolve, reject) => {
    let dateString = getDateString (start);
    let file       = folder + '/' + dateString + '.json';
    let options    = JSON.parse (JSON.stringify (API_OPTIONS));
    options.path   = options.path + ([dateString, symbol1, symbol2].join ('/'));

    if (start < getCoinPairStart (symbol1, symbol2)) { reject ('Skipping past    : ' + dateString); return; }  
    if (start > new Date())                          { reject ('Skipping future  : ' + dateString); return; }
    if (fs.existsSync (file))                        { reject ('Skipping existing: ' + dateString); return; }

    request (options, (error, response, body) => {
      if (error) { reject (error); }

      // resolve ({file: file, data: body});
      setTimeout (function () { resolve ({file: file, data: body}); }, TIMEOUT);
    });
  }).then (writeFile).catch ((error) => { console.log (error); });
}

function getMonth (symbol1, symbol2, start, folder) {
  if (PARALLEL_DAYS) { return Promise.all (getDatesBetween (startOfMonth (start), endOfMonth (start), stepDays).map (day => getDay (symbol1, symbol2, day, folder))); }
  return Promise.sequence (getDatesBetween (startOfMonth (start), endOfMonth (start), stepDays).map (day => getDay.bind (null, symbol1, symbol2, day, folder)));
}

function getYear (symbol1, symbol2, start, folder) {
  if (PARALLEL_MONTHS) { return Promise.all (getDatesBetween (startOfYear (start), endOfYear (start), stepMonths).map (month => getMonth (symbol1, symbol2, month, folder))); }
  return Promise.sequence (getDatesBetween (startOfYear (start), endOfYear (start), stepMonths).map (month => getMonth.bind (null, symbol1, symbol2, month, folder)));
}

function getYears (symbol1, symbol2, start, folder) {
  if (PARALLEL_YEARS) { return Promise.all (getDatesBetween (midnight (start), midnight (new Date ()), stepYears).map (year => getYear (symbol1, symbol2, year, folder))); }
  return Promise.sequence (getDatesBetween (midnight (start), midnight (new Date ()), stepYears).map (year => getYear.bind (null, symbol1, symbol2, year, folder)));
}

function getCoinPairHistory (symbol1, symbol2, start) {
  if (COIN_BLACK_LIST.indexOf (symbol1) >= 0 
  ||  COIN_BLACK_LIST.indexOf (symbol2) >= 0) { 
    console.log ('Skipping Blacklisted Coinpair: ' + symbol1 + '-' + symbol2); 
    return Promise.resolve ();
  }

  let folder = HISTORIES_FOLDER +  symbol1 + '-' + symbol2;
  maybeCreateFolder (folder);
  console.log ('Starting: ' + symbol1 + '-' + symbol2);
  return getYears (symbol1, symbol2, new Date (start), folder).then(() => {
    console.log ('Finished: ' + symbol1 + '-' + symbol2);
  });
}

function getAllCoinPairHistory (coinPairs, start) {
  if (PARALLEL_PAIRS) { return Promise.all (coinPairs.map (coinpair => getCoinPairHistory (coinpair.symbol1, coinpair.symbol2, getCoinPairStart (coinpair.symbol1, coinpair.symbol2)))); }
  return Promise.sequence (coinPairs.map (coinpair => getCoinPairHistory.bind (null, coinpair.symbol1, coinpair.symbol2, getCoinPairStart (coinpair.symbol1, coinpair.symbol2))));
}

maybeCreateFolder (DATA_FOLDER);
maybeCreateFolder (HISTORIES_FOLDER);

if (!fs.existsSync (CURRENCY_LIMITS_FILE)) { 
  console.log (CURRENCY_LIMITS_FILE + ' not found. launching: ' + CURRENCY_LIMITS_CMD);
  try {
    child_process.execSync (CURRENCY_LIMITS_CMD);
    if (!fs.existsSync (CURRENCY_LIMITS_FILE)) { 
      console.log ('file does not exist: ' + CURRENCY_LIMITS_FILE); 
      process.exit (3);
    }
  } catch (error) { process.exit (2); }
}

let coinPairs;
try {
  coinPairs = JSON.parse (fs.readFileSync (CURRENCY_LIMITS_FILE)).pairs;
} catch (error) {
  console.log ('Could not read and parse: ' + CURRENCY_LIMITS_FILE);
  console.log (error);
  process.exit (4);
}

getAllCoinPairHistory (coinPairs)
  .then  (()       => { console.log ('Prices Histories Done.'); })
  .catch ((reason) => { console.log (reason); process.exit (5); });
 