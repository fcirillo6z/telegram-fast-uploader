const config = require('config')

const token = config.get('bot-token')
const chatId = config.get('chatId')
const monitoredFolder = config.get('watchFolder')
const convertedFolder = config.get('convertedFolder') ?? monitoredFolder
const debouncedEvents = config.has('debonucedEvents') ? config.get('debonucedEvents') : []
const debounceInMin = config.has('debounceInMin') ? config.get('debounceInMin') : 0
const ignoredEvents = config.has('ignoredEvents') ? config.get('ignoredEvents') : []
const videoduration = config.has('videoduration') ? config.get('videoduration') : 15
module.exports = { videoduration, ignoredEvents, debounceInMin, debouncedEvents, convertedFolder, monitoredFolder, token, chatId }
