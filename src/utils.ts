import { v4 as uuidv4, validate as uuidValidate } from 'uuid'

export const generateStepId = () => {
  return `step-${uuidv4()}`
}

export const isStepIdValid = (id: string) => {
  if (!id.startsWith('step-')) return false
  return uuidValidate(id.substring(5))
}
