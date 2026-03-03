// Mock chalk for Jest (avoids ESM import issues with chalk v5)
const identity = (str) => str

const chalk = {
  red: identity,
  green: identity,
  blue: identity,
  yellow: identity,
  cyan: identity,
  magenta: identity,
  white: identity,
  gray: identity,
  grey: identity,
  bold: Object.assign(identity, {
    red: identity,
    green: identity,
    blue: identity,
    yellow: identity,
    cyan: identity,
  }),
  dim: identity,
  underline: identity,
  italic: identity,
}

module.exports = chalk
module.exports.default = chalk
