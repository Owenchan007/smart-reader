import React, { useState } from 'react'
import { Button, Space, Tooltip, Modal, Input, Select, Slider } from 'antd'
import {
  BookOutlined,
  MessageOutlined,
  FormOutlined,
  SettingOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons'
import { useStore } from '../stores/useStore'

const AppHeader: React.FC = () => {
  const {
    view, setView, currentBook,
    rightPanel, setRightPanel,
    apiKey, setApiKey, aiModel, setAiModel,
    readerSettings, setReaderSettings,
  } = useStore()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const handleSaveSetting = (key: string, value: string) => {
    window.electronAPI.saveSetting(key, value)
  }

  return (
    <>
      <div className="app-header">
        {view === 'reader' && (
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => setView('library')}
          >
            书库
          </Button>
        )}

        <div style={{ flex: 1, textAlign: 'center', fontWeight: 600 }}>
          {view === 'reader' && currentBook ? currentBook.title : '智能读书笔记'}
        </div>

        <Space>
          {view === 'reader' && (
            <>
              <Tooltip title="AI 问答">
                <Button
                  type={rightPanel === 'chat' ? 'primary' : 'text'}
                  icon={<MessageOutlined />}
                  onClick={() => setRightPanel('chat')}
                />
              </Tooltip>
              <Tooltip title="笔记">
                <Button
                  type={rightPanel === 'notes' ? 'primary' : 'text'}
                  icon={<FormOutlined />}
                  onClick={() => setRightPanel('notes')}
                />
              </Tooltip>
            </>
          )}
          <Tooltip title="设置">
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
            />
          </Tooltip>
        </Space>
      </div>

      <Modal
        title="设置"
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        footer={null}
        width={480}
      >
        <div className="settings-group">
          <label>AI API Key</label>
          <Input.Password
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              handleSaveSetting('apiKey', e.target.value)
            }}
            placeholder="请输入腾讯云 Coding Plan API Key"
          />
        </div>

        <div className="settings-group">
          <label>AI 模型</label>
          <Select
            value={aiModel}
            onChange={(val) => {
              setAiModel(val)
              handleSaveSetting('aiModel', val)
            }}
            style={{ width: '100%' }}
            options={[
              { label: 'Hunyuan Turbos (快速响应)', value: 'hunyuan-turbos' },
              { label: 'Hunyuan 2.0 Thinking (深度推理)', value: 'hunyuan-2.0-thinking' },
              { label: 'Kimi K2.5 (长文本)', value: 'kimi-k2.5' },
              { label: 'GLM-4 Plus', value: 'glm-4-plus' },
              { label: 'MiniMax', value: 'minimax' },
            ]}
          />
        </div>

        <div className="settings-group">
          <label>字号：{readerSettings.fontSize}px</label>
          <Slider
            min={12}
            max={32}
            value={readerSettings.fontSize}
            onChange={(val) => {
              setReaderSettings({ fontSize: val })
              handleSaveSetting('fontSize', String(val))
            }}
          />
        </div>

        <div className="settings-group">
          <label>字体</label>
          <Select
            value={readerSettings.fontFamily}
            onChange={(val) => {
              setReaderSettings({ fontFamily: val })
              handleSaveSetting('fontFamily', val)
            }}
            style={{ width: '100%' }}
            options={[
              { label: '系统默认', value: 'system-ui' },
              { label: '思源宋体', value: '"Noto Serif SC", serif' },
              { label: '思源黑体', value: '"Noto Sans SC", sans-serif' },
              { label: '楷体', value: 'KaiTi, STKaiti, serif' },
            ]}
          />
        </div>

        <div className="settings-group">
          <label>阅读主题</label>
          <Select
            value={readerSettings.theme}
            onChange={(val) => {
              setReaderSettings({ theme: val })
              handleSaveSetting('theme', val)
            }}
            style={{ width: '100%' }}
            options={[
              { label: '明亮', value: 'light' },
              { label: '护眼', value: 'warm' },
              { label: '暗色', value: 'dark' },
            ]}
          />
        </div>
      </Modal>
    </>
  )
}

export default AppHeader
