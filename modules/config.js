/* eslint-disable space-before-function-paren */

const config = require('config')

const token = config.get('bot-token')
const chatId = config.get('chatId')
const monitoredFolder = config.get('watchFolder')
const convertedFolder = config.get('convertedFolder') ?? monitoredFolder
const debouncedEvents = config.has('debonucedEvents') ? splitArray(config.get('debonucedEvents')) : []
const debounceInMin = config.has('debounceInMin') ? config.get('debounceInMin') : 0
const ignoredEvents = config.has('ignoredEvents') ? splitArray(config.get('ignoredEvents')) : []
const videoduration = config.has('videoduration') ? config.get('videoduration') : 15

function splitArray(csv) {
  if (!csv || !csv.length || typeof csv !== 'string') {
    return []
  }
  return csv.trim().split(',').map(element => element.trim())
}

module.exports = { videoduration, ignoredEvents, debounceInMin, debouncedEvents, convertedFolder, monitoredFolder, token, chatId }
