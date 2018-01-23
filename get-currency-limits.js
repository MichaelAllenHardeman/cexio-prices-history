
const fs            = require ('fs');
const request       = require ('request');

const API_URL              = 'https://cex.io/api/currency_limits';
const DATA_FOLDER          = __dirname + '/data/';
const CURRENCY_LIMITS_FILE = DATA_FOLDER + 'currency-limits.json';

function maybeCreateFolder (folder) {
  if (fs.existsSync (folder)) { return; }
  fs.mkdirSync(folder);
}

function writeFile (result) {
  fs.writeFileSync(result.file, JSON.stringify (result.data, null, 2));
}

function getLimits () {
  return new Promise ((resolve, reject) => {
    request(API_URL, (error, response, body) => {
      if (error)            { reject (error); }
      let parsed = JSON.parse (body);
      if (parsed.ok !== 'ok') { reject ({response: response, body: parsed}); }
      resolve ({file: CURRENCY_LIMITS_FILE, data: parsed.data});
    });
  }).then (writeFile).catch ((error) => { console.log (error); });
}

maybeCreateFolder (DATA_FOLDER);

getLimits ()
  .then  (()       => { console.log ('Currency Limits Done.');  })
  .catch ((reason) => { console.log (reason); process.exit (2); });
