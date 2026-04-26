import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { runValidation } from './validate.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defaultModelPath = path.resolve(__dirname, '../../../backend/__pycache__/rl_traffic_model_balanced.json')
const defaultOutputPath = path.resolve(__dirname, '../../../rl_validation_results.json')

const modelPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultModelPath
const outPath = process.argv[3] ? path.resolve(process.argv[3]) : defaultOutputPath

async function main() {
  console.log('Loading RL model from:', modelPath)
  const modelJson = await fs.readFile(modelPath, 'utf-8')
  const model = JSON.parse(modelJson)

  console.log('Running RL validation...')
  const results = await runValidation(model)

  const output = {
    sourceModel: modelPath,
    generatedAt: new Date().toISOString(),
    results,
  }

  await fs.writeFile(outPath, JSON.stringify(output, null, 2), 'utf-8')
  console.log('Exported RL validation metrics to:', outPath)
}

main().catch((err) => {
  console.error('Export failed:', err)
  process.exit(1)
})
