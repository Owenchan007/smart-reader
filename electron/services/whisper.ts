import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import https from 'https'
import http from 'http'

/** Model download info */
const MODEL_INFO: Record<string, { url: string; size: number }> = {
  base: {
    url: 'https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt',
    size: 145_262_807,
  },
  medium: {
    url: 'https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt',
    size: 1_528_006_450,
  },
}

/** Get the cache directory where whisper stores models */
function getModelPath(model: string): string {
  return path.join(os.homedir(), '.cache', 'whisper', `${model}.pt`)
}

/** Check if the whisper model is already downloaded and valid */
export function isModelDownloaded(model: string): boolean {
  const modelPath = getModelPath(model)
  if (!fs.existsSync(modelPath)) return false
  const stat = fs.statSync(modelPath)
  const expected = MODEL_INFO[model]?.size
  // If we know the expected size, verify the file isn't truncated
  if (expected && stat.size < expected * 0.95) return false
  return true
}

/**
 * Download whisper model with progress reporting.
 * Supports custom mirror URL for users in China.
 */
export function downloadModel(
  model: string,
  onProgress?: (percent: number, downloadedMB: number, totalMB: number) => void,
  mirrorUrl?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const info = MODEL_INFO[model]
    if (!info) return reject(new Error(`未知模型: ${model}`))

    const url = mirrorUrl || info.url
    const cacheDir = path.join(os.homedir(), '.cache', 'whisper')
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })

    const destPath = getModelPath(model)
    const tempPath = destPath + '.download'

    // Clean up any partial previous download
    try { fs.unlinkSync(tempPath) } catch {}

    const file = fs.createWriteStream(tempPath)

    console.log(`[Whisper] Downloading model "${model}" from ${url}`)

    const doRequest = (reqUrl: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        file.close()
        try { fs.unlinkSync(tempPath) } catch {}
        return reject(new Error('下载重定向次数过多'))
      }

      const get = reqUrl.startsWith('https') ? https.get : http.get
      get(reqUrl, (res) => {
        // Handle redirects
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          res.resume() // drain response
          doRequest(res.headers.location, redirectCount + 1)
          return
        }

        if (res.statusCode !== 200) {
          file.close()
          try { fs.unlinkSync(tempPath) } catch {}
          reject(new Error(`下载失败，HTTP ${res.statusCode}`))
          return
        }

        const totalSize = parseInt(res.headers['content-length'] || '0', 10) || info.size
        let downloaded = 0
        let lastReportedPercent = -1

        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          const percent = Math.round((downloaded / totalSize) * 100)
          if (onProgress && percent !== lastReportedPercent) {
            lastReportedPercent = percent
            onProgress(
              percent,
              Math.round(downloaded / 1024 / 1024),
              Math.round(totalSize / 1024 / 1024),
            )
          }
        })

        res.pipe(file)

        file.on('finish', () => {
          file.close(() => {
            // Rename temp file to final destination
            try {
              fs.renameSync(tempPath, destPath)
              console.log(`[Whisper] Model "${model}" downloaded successfully`)
              resolve()
            } catch (err: any) {
              reject(new Error(`保存模型文件失败: ${err.message}`))
            }
          })
        })

        res.on('error', (err) => {
          file.close()
          try { fs.unlinkSync(tempPath) } catch {}
          reject(new Error(`下载出错: ${err.message}`))
        })
      }).on('error', (err) => {
        file.close()
        try { fs.unlinkSync(tempPath) } catch {}
        reject(new Error(`网络连接失败: ${err.message}`))
      })
    }

    doRequest(url)
  })
}

/**
 * Transcribe audio buffer using local whisper CLI.
 * Accepts a WAV file buffer, writes to temp file, runs whisper, returns text.
 */
export function transcribeAudio(audioBuffer: Buffer, model = 'medium'): Promise<string> {
  return new Promise((resolve, reject) => {
    const tmpDir = os.tmpdir()
    const wavPath = path.join(tmpDir, `whisper-${Date.now()}.wav`)
    const outputPath = path.join(tmpDir, `whisper-${Date.now()}`)

    // Write audio to temp file
    fs.writeFileSync(wavPath, audioBuffer)

    // Call whisper CLI
    const cmd = `whisper "${wavPath}" --model ${model} --language zh --output_format txt --output_dir "${tmpDir}" --fp16 False 2>&1`

    console.log('[Whisper] Running:', cmd)

    exec(cmd, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      // Read the output txt file
      const txtPath = wavPath.replace('.wav', '.txt')
      let transcript = ''

      if (fs.existsSync(txtPath)) {
        transcript = fs.readFileSync(txtPath, 'utf-8').trim()
        fs.unlinkSync(txtPath) // cleanup
      }

      // Clean up temp files
      try { fs.unlinkSync(wavPath) } catch {}
      // whisper may also create .srt, .vtt etc
      for (const ext of ['.srt', '.vtt', '.tsv', '.json']) {
        try { fs.unlinkSync(wavPath.replace('.wav', ext)) } catch {}
      }

      if (error && !transcript) {
        console.error('[Whisper] Error:', error.message, stdout)
        reject(new Error(`Whisper 转写失败: ${error.message}`))
        return
      }

      if (!transcript) {
        console.warn('[Whisper] No transcript found. stdout:', stdout)
        reject(new Error('Whisper 未能识别出文字'))
        return
      }

      console.log('[Whisper] Transcript:', transcript.slice(0, 100))
      resolve(transcript)
    })
  })
}
