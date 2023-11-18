require('./config')
const makeWASocket = require("@whiskeysockets/baileys").default;
const { BufferJSON, WA_DEFAULT_EPHEMERAL, generateWAMessageFromContent, proto, generateWAMessageContent, generateWAMessage, prepareWAMessageMedia, areJidsSameUser, getContentType, PHONENUMBER_MCC, makeCacheableSignalKeyStore, WAMessageKey } = require("@whiskeysockets/baileys");
const { Sticker, createSticker, StickerTypes } = require('wa-sticker-formatter');
const util = require("util");
const { useMultiFileAuthState, jidDecode, makeInMemoryStore, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const logger = require("@whiskeysockets/baileys/lib/Utils/logger").default;
const Pino = require("pino");
const gp = ["254762974923"];
const fs = require("fs");
const figlet = require("figlet");
const chalk = require("chalk");
const os = require("os");
const speed = require("performance-now");
const NodeCache = require("node-cache");
const readline = require("readline");
const timestampe = speed();
const spikespeed = speed() - timestampe;
const { Client, Serialize } = require("./lib/serialize.js")

const spinnies = new (require('spinnies'))();

const { Boom } = require("@hapi/boom");
const color = (text, color) => {
  return !color ? chalk.green(text) : chalk.keyword(color)(text);
};


const store = makeInMemoryStore({ logger: Pino({ level: "fatal" }).child({ level: "fatal" }) })

function nocache(module, cb = () => { }) {
	console.log(`${module} waiting for information..`) 
	fs.watchFile(require.resolve(module), async () => {
		await uncache(require.resolve(module))
		cb(module)
	})
}

function uncache(module = '.') {
	return new Promise((resolve, reject) => {
		try {
			delete require.cache[require.resolve(module)]
			resolve()
		} catch (e) {
			reject(e)
		}
	})
}

const usePairingCode = !!global.pairingNum || process.argv.includes('--use-pairing-code')
const useMobile = process.argv.includes('--mobile')

function smsg(m, conn) {
  if (!m) return;
  let M = proto.WebMessageInfo;
  if (m.key) {
    m.id = m.key.id;
    m.isBaileys = m.id.startsWith("BAE5") && m.id.length === 16;
    m.chat = m.key.remoteJid;
    m.fromMe = m.key.fromMe;
    m.isGroup = m.chat.endsWith("@g.us");
    m.sender = conn.decodeJid((m.fromMe && conn.user.id) || m.participant || m.key.participant || m.chat || "");
    if (m.isGroup) m.participant = conn.decodeJid(m.key.participant) || "";
  }
  return m;
}

/* reading a line */
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text) => new Promise((resolve) => rl.question(text, resolve))

/* starting a connection */
  async function main() {
	const { state, saveCreds } = await useMultiFileAuthState('./spike')
	const msgRetryCounterCache = new NodeCache()

    const sock = makeWASocket({
	  logger: Pino({ level: "fatal" }).child({ level: "fatal" }), 
	  printQRInTerminal: !usePairingCode,
      mobile: useMobile,
      auth: {
         creds: state.creds,
         keys: makeCacheableSignalKeyStore(state.keys, Pino({ level: "fatal" }).child({ level: "fatal" })),
      },
      browser: ['Chrome (Linux)', '', ''],
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
      getMessage: async (key) => {
         let jid = jidNormalizedUser(key.remoteJid)
         let msg = await store.loadMessage(jid, key.id)
         return msg?.message || ""
      },
      msgRetryCounterCache, 
      defaultQueryTimeoutMs: undefined,
	})

  store.bind(sock.ev)

  /* connecting using pairing code */
	if (usePairingCode && !sock.authState.creds.registered) {
      if (useMobile) throw new Error('Cannot use pairing code with mobile api')
	
let phoneNumber
      if (!!global.pairingNum) {
         phoneNumber = global.pairingNum.replace(/[^0-9]/g, '')

         if (!Object.keys(PHONENUMBER_MCC).some(v => phoneNumber.startsWith(v))) {
            console.log(chalk.bgBlack(chalk.redBright("Start with your country's WhatsApp code, Example : 254xxx")))
            process.exit(0)
         }
      } else {
         phoneNumber = await question(chalk.bgBlack(chalk.greenBright(`Please type your WhatsApp number : `)))
         phoneNumber = phoneNumber.replace(/[^0-9]/g, '')

         /* Ask again when entering the wrong number */
         if (!Object.keys(PHONENUMBER_MCC).some(v => phoneNumber.startsWith(v))) {
            console.log(chalk.bgBlack(chalk.redBright("Start with your country's WhatsApp code, Example : 254xxx")))

            phoneNumber = await question(chalk.bgBlack(chalk.greenBright(`Please type your WhatsApp number : `)))
            phoneNumber = phoneNumber.replace(/[^0-9]/g, '')
            rl.close()
         }
      }

      setTimeout(async () => {
         let code = await sock.requestPairingCode(phoneNumber)
         code = code?.match(/.{1,4}/g)?.join("-") || code
         console.log(chalk.black(chalk.bgBlue(`Your Pairing Code : `)), chalk.black(chalk.white(code)))
      }, 3000)
   }
		

	/* mobile connection */
	if(useMobile && !sock.authState.creds.registered) {
		const { registration } = sock.authState.creds || { registration: {} }

		if(!registration.phoneNumber) {
			         let phoneNumber = await question(chalk.bgBlack(chalk.greenBright(`Please type your WhatsApp number : `)))
         phoneNumber = phoneNumber.replace(/[^0-9]/g, '')
		
		if (!Object.keys(PHONENUMBER_MCC).some(v => phoneNumber.startsWith(v))) {
            console.log(chalk.bgBlack(chalk.redBright("Start with your country's WhatsApp code, Example : 254xxx")))

            phoneNumber = await question(chalk.bgBlack(chalk.greenBright(`Please type your WhatsApp number : `)))
            phoneNumber = phoneNumber.replace(/[^0-9]/g, '')
         }

         registration.phoneNumber = "+" + phoneNumber
      }

		const phoneNumber = parsePhoneNumber(registration.phoneNumber)
		if(!phoneNumber?.isValid()) {
			throw new Error('Invalid phone number: ' + registration.phoneNumber)
		}

		registration.phoneNumber = phoneNumber.format('E.164')
		registration.phoneNumberCountryCode = phoneNumber.countryCallingCode
		registration.phoneNumberNationalNumber = phoneNumber.nationalNumber
		const mcc = PHONENUMBER_MCC[phoneNumber.countryCallingCode]
		registration.phoneNumberMobileCountryCode = mcc

		async function enterCode() {
			try {
				const code = await question('Please enter the one time code:\n')
				const response = await sock.register(code.replace(/["']/g, '').trim().toLowerCase())
				console.log('Successfully registered your phone number.')
				console.log(response)
				rl.close()
			} catch(error) {
				console.error('Failed to register your phone number. Please try again.\n', error)
				await askForOTP()
			}
		}

		async function enterCaptcha() {
			const response = await sock.requestRegistrationCode({ ...registration, method: 'captcha' })
			const path = __dirname + '/captcha.png'
			fs.writeFileSync(path, Buffer.from(response.image_blob, 'base64'))

			open(path)
			const code = await question('Please enter the captcha code:\n')
			fs.unlinkSync(path)
			registration.captcha = code.replace(/["']/g, '').trim().toLowerCase()
		}
async function askOTP() {
         if (!registration.method) {
            let code = await question(chalk.bgBlack(chalk.greenBright('What method do you want to use? "sms" or "voice" : ')))
            code = code.replace(/["']/g, '').trim().toLowerCase()

            if (code !== 'sms' && code !== 'voice') return await askOTP()

            registration.method = code
         }

         try {
            await sock.requestRegistrationCode(registration)
            await enterCode()
         } catch (e) {
            console.error('Failed to request registration code. Please try again.\n', e)
            if (e?.reason === 'code_checkpoint') {
               await enterCaptcha()
            }
            await askOTP()
         }
      }

      await askOTP()
   }
   
   /* write session */
   sock.ev.on("creds.update", saveCreds)	
   /* update no restart */
   nocache('./spike', module => console.log(chalk.yellow(` "${module}" updated!`)))
   nocache('./lib/serialize', module => console.log(chalk.yellow(` "${module}" updated!`)))
	
  sock.ev.on('messages.upsert', async chatUpdate => {
    m = chatUpdate.messages[0];
    m.chat = m.key.remoteJid;
    m.fromMe = m.key.fromMe;
    m.sender = sock.decodeJid((m.fromMe && sock.user.id) || m.participant || m.key.participant || m.chat);

    const groupMetadata = m.isGroup ? await sock.groupMetadata(m.chat).catch((e) => {}) : "";
    const groupName = m.isGroup ? groupMetadata.subject : "";

    if (!m.message) return;

    if (m.chat.endsWith('@s.whatsapp.net')) {
              sock.sendPresenceUpdate('recording', m.chat)
    }      if (m.chat.endsWith('broadcast')) {
    sock.readMessages([m.key]);
    if (!m.isGroup) {
      const status = 'life<LifeMotive[]>(memories.map(x => x.data))'
await sock.updateProfileStatus(status);
    }

  });
    sock.decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      let decode = jidDecode(jid) || {};
      return (decode.user && decode.server && decode.user + "@" + decode.server) || jid;
    } else return jid;
  };

  sock.ev.on('connection.update', async (update) => {
    const {
      connection,
      lastDisconnect,
      qr
    } = update;
    if (lastDisconnect == 'undefined' && qr != 'undefined') {
      qrcode.generate(qr, {
        small: true
      });
    }
    if (connection === 'connecting') {
      spinnies.add('start', {
        text: 'Connecting Now. . .'
      });
    } else if (connection === 'open') {
      spinnies.succeed('start', {
        text: `Successfully Connected. You have logged in as ${sock.user.name}`
      });
    } else if (connection === 'close') {
      if (lastDisconnect.error.output.statusCode == DisconnectReason.loggedOut) {
        spinnies.fail('start', {
          text: `Can't connect!`
        });

        process.exit(0);
      } else {
        main().catch(() => main());
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);
};

main();