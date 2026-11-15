const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Drizzleのマイグレーション（.sql）を読み込めるようにする
config.resolver.sourceExts.push('sql');

module.exports = config;
