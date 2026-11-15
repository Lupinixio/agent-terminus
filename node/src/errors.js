/**
 * Raised by a check when configuration or sources make the check impossible
 * (missing provider or peer, unparseable source). The CLI maps it to exit 3.
 */
export class ConfigError extends Error {
  /**
   * @param {string} file
   * @param {string} key
   * @param {string} message
   */
  constructor(file, key, message) {
    super(message);
    this.name = 'ConfigError';
    this.file = file;
    this.key = key;
  }
}
