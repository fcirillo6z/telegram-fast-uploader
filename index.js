/* eslint-disable space-before-function-paren */
process.env.NTBA_FIX_319 = 1
const fsProm = require('node:fs/promises')
const fs = require('node:fs')
const chokidar = require('chokidar')
const logger = require('./modules/Logging')
const anymatch = require('anymatch')
const { exec } = require('child_process')
const path = require('path')
const readline = require('readline')
const TelegramBot = require('node-telegram-bot-api')

const { videoduration, ignoredEvents, debounceInMin, debouncedEvents, convertedFolder, monitoredFolder, token, chatId } = require('./modules/config')

let _debouncedInner = []

const sendTelegram = async function (bot, body, files) {
  if (!bot) {
    logger.debug('bot non trovato')
    return
  }
  if (bot && bot.sendMessage) {
    try {
      if (body) {
        await sendMessage(bot, body)
      }
      if (files) {
        files.forEach(async (file) => {
          switch (file.type) {
            case 'video':
              await bot.sendVideo(chatId, file.attachment, {}, {
                filename: file.name, contentType: 'audio/mpeg'
              })
              break
            case 'photo':
              await bot.sendPhoto(chatId, file.attachment, {}, { filename: file.name, contentType: 'image' })
              break
          }
        })
      }
    } catch (err) {
      logger.error('Telegram Error', err)
    }
  } else {
    logger.error('Telegram Error')
  }
}

async function sendMessage(bot, body) {
  await bot.sendMessage(chatId, `${body.title}${body.description ? '\n' + body.description : ''}`)
}

function convertDAVtoMP4(davFile) {
  const mp4FileBase = getConverted()

  return new Promise((resolve, reject) => {
    const mp4FilePath = path.format({
      ...path.parse(mp4FileBase),
      base: undefined,
      ext: '.mp4'
    })

    const command = `ffmpeg -i ${davFile} -vf "scale=iw/2:ih/2" -vcodec libx264 -t ${videoduration} -crf 27 -preset veryfast ${mp4FilePath}`

    exec(command, (error) => {
      if (error) {
        logger.error(`Errore durante la conversione del file: ${error}`)
        reject(error)
      } else {
        logger.debug(`File convertito con successo in: ${mp4FilePath}`)
        resolve(mp4FilePath)
      }
    })
  })
}

// const idxPattern = '**/*.idx'
const davPattern = '**/*.dav'
const jpgPattern = '**/*.jpg'

chokidar.watch(monitoredFolder, {
  // ignored: (string) => !anymatch([davPattern, jpgPattern, jpegPattern], string),
  persistent: true,
  ignoreInitial: true,
  usePolling: false,
  awaitWriteFinish: {
    stabilityThreshold: 1000,
    pollInterval: 100
  }
}).on('add', async (file) => {
  handleFileName(path.normalize(file))
})

async function handleFileName(file) {
  let convertedFilePath
  let deleteFlag = false
  try {
    const bot = new TelegramBot(token, { polling: false })
    if (anymatch(jpgPattern, file)) {
      const buffer = await fsProm.readFile(file)
      logger.debug(`Sending image ${path.parse(file).base} with size: ${buffer.byteLength} bytes`)
      await sendTelegram(bot, {
        title: 'Uploading image.',
        description: `Uploaded image ${path.parse(file).base}`
      }, [
        {
          type: 'photo',
          attachment: buffer,
          name: path.parse(file).base
        }
      ])
      logger.debug(`Image sent: ${buffer.byteLength} bytes`)
    // } else if (anymatch(idxPattern, file)) {
    //   const eventInfo = await readEventInfoFromFile(file)
    //   if (eventInfo && (eventInfo.Name?.length > 0 && !ignoredEvents.includes(eventInfo.Name) && !_debouncedInner.includes(eventInfo.Name))) {
    //     try {
    //       await sendMessage(bot, {
    //         title: 'Event',
    //         description: `Event of type: ${eventInfo.Name ?? 'Motion'}`
    //       })
    //     } catch (err) {
    //       logger.error('Telegram Error', err)
    //     }
    //   } else {
    //     if (!(eventInfo?.Name) || eventInfo?.Name?.length === 0) {
    //       logger.debug(`File ignored : ${file}. Event name not read correctly`)
    //     }
    //     if (ignoredEvents.includes(eventInfo.Name)) {
    //       logger.debug(`File ignored : ${file}. ${eventInfo?.Name ? `Type: ${eventInfo.Name}` : ''}`)
    //     }
    //     if (_debouncedInner.includes(eventInfo.Name)) {
    //       logger.debug(`File ignored for not enough time passed between similar events : ${file}. ${eventInfo?.Name ? `Type: ${eventInfo.Name}` : ''}`)
    //     }
    //   }
    } else if (anymatch(davPattern, file)) {
      logger.debug(`Dav file found: ${path.parse(file).base}`)

      // find idxFile
      const idxFile = findFileWithSameName(file, '.idx')

      let eventInfo
      try {
        // idx file may not be created yet, so retry 5 times
        eventInfo = await retry(() => readEventInfoFromFile(idxFile), 5, 50)
      } catch (error) {
        logger.debug(`No event file found. [${error}] for file: ${path.parse(file).base}`)
      }
      if (eventInfo) {
        if (!ignoredEvents || !(ignoredEvents?.length) || !ignoredEvents.includes(eventInfo.Name)) {
          if (debouncedEvents.includes(eventInfo.Name)) {
            if (_debouncedInner.includes(eventInfo.Name)) {
              logger.debug(`File ignored for not enough time passed between similar events : ${file}. ${eventInfo?.Name ? `Type: ${eventInfo.Name}` : ''}`)
            } else {
              try {
                await sendMessage(bot, {
                  title: 'Event',
                  description: `Event of type: ${eventInfo.Name ?? 'Motion'}`
                })
              } catch (err) {
                logger.error('Telegram Error', err)
              }
              await handleDavFile(file, convertedFilePath, bot)
              _debouncedInner.push(eventInfo.Name)
              setTimeout(() => {
                _debouncedInner = [..._debouncedInner.filter((name) => name !== eventInfo.Name)]
              }, debounceInMin * 60000)
            }
          } else {
            await handleDavFile(file, convertedFilePath, bot)
          }
        } else {
          if (ignoredEvents?.length && ignoredEvents.includes(eventInfo.Name)) {
            logger.debug(`File ignored : ${file}. ${eventInfo?.Name ? `Type: ${eventInfo.Name}` : ''}`)
          }
        }
      }
      deleteFlag = true
    }

    if (deleteFlag) {
      logger.debug(`Deleting original file at: ${file}`)
      await fsProm.unlink(file)
    }
  } catch (error) {
    logger.error(`Telegram-uploader-error: ${file}`, error)
  }
}

async function handleDavFile(file, convertedFilePath, bot) {
  logger.debug(`Converting dav file: ${path.parse(file).base}`)
  convertedFilePath = await convertDAVtoMP4(file)
  logger.debug(`Converted mp4 file: ${path.parse(convertedFilePath).base}`)

  const convertedBuffer = await fsProm.readFile(convertedFilePath)
  if (convertedBuffer.byteLength) {
    logger.debug(`Sending video ${path.parse(convertedFilePath).base} with size: ${convertedBuffer.byteLength} bytes`)
    await sendTelegram(bot, undefined, [
      {
        type: 'video',
        attachment: convertedBuffer,
        name: path.parse(convertedFilePath).base
      }
    ])
    logger.debug(`Video sent ${path.parse(convertedFilePath).base}.`)

    if (convertedFilePath) {
      await fsProm.unlink(convertedFilePath)
      logger.debug(`Deleted mp4 file at :${convertedFilePath}`)
    }
  }
  return convertedFilePath
}

function getConverted() {
  const now = new Date()
  return `${convertedFolder}/${now.getFullYear()}_${(now.getMonth() + 1).toString().padStart(2, '0')}_${(now.getDate()).toString().padStart(2, '0')}T${now.getHours().toString().padStart(2, '0')}_${now.getMinutes().toString().padStart(2, '0')}_${now.getSeconds().toString().padStart(2, '0')}_${now.getMilliseconds().toString().padStart(3, '0')}`
}

process.on('uncaughtException', (error) => {
  logger.error('FATAL: ', error)
})

logger.info('Started watching folder.')
logger.info(`Watchfolder: ${monitoredFolder}`)

async function readEventInfoFromFile(file) {
  logger.debug(`Reading idx file: ${file}`)

  const fileStream = fs.createReadStream(file)
  if (fileStream) {
    const rl = readline.createInterface({
      input: fileStream
    })
    for await (const line of rl) {
      if (line.startsWith('Event=')) {
        const eventRaw = line.substring(6)
        return JSON.parse(eventRaw)
      }
    }
  }
}

function findFileWithSameName(file, extension) {
  const parsed = path.parse(file)
  return path.format({
    dir: parsed.dir,
    name: parsed.name,
    ext: extension
  })
}
function retry(operation, maxAttempts, delay) {
  return new Promise((resolve, reject) => {
    return operation()
      .then(resolve)
      .catch((reason) => {
        if (maxAttempts <= 0) {
          reject(reason)
        } else {
          setTimeout(() => {
            retry(operation, maxAttempts - 1, delay)
              .then(resolve)
              .catch(reject)
          }, delay)
        }
      })
  })
}
