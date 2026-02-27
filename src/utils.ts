import { Maybe } from './types.js'

/**
 * Provides a standard way of handling objects that change state.
 * @returns
 */
export const stateful = <T>(): Readonly<{
  instance: () => Maybe<T>
  set: (value: T) => void
}> => {
  // eslint-disable-next-line functional/no-let
  let _instance: T | undefined = undefined

  const set = (value: T) => {
    _instance = value
  }

  return {
    instance: () => maybe(_instance),
    set,
  }
}

/**
 * A wrapper around an instance, that may or may not have a value.
 * @param _instance
 * @returns
 */
export const maybe = <T>(_instance: T | undefined): Maybe<T> => {
  const instance = () => {
    return _instance
  }

  const hasValue = () => {
    return _instance !== undefined
  }

  return {
    instance,
    hasValue,
  }
}
