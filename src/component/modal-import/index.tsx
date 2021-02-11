import React, { useReducer } from 'react'
import {
  Button,
  Dropdown,
  Menu,
  Input,
  Modal,
  Drawer,
  Typography,
  ModalProps,
  Form,
  Row,
  Col,
  Avatar,
  Select,
  notification,
  Spin
} from 'antd'
import p from 'prefix-classname'
import isHotKey from 'is-hotkey'
import 'github-markdown-css/github-markdown.css'

const cn = p()
const c = p('jira_modal-import')

import './style.sass'
import JiraApiBrowser from '../../shared/jira-api-browser'
import parseHtmlTreeNode from '../../shared/parse-html-treenode'
import treeNodeToMdast from '../../shared/tree-node-to-mdast'
import JiraImportPreview from '../import-preview'
import mdastToTreeNodes from '../../shared/mdast-to-tree-node'
import { markdown2confluence } from '../../shared/markdown-to-confluence'
import mdastStringify from '../../shared/mdast-stringify'
import { JiraSuggest } from '../epic-link-suggest'
import TreeNode from '../../shared/tree-node'
import url from 'url'
import treeNodesToConfluence from "../../shared/tree-node-to-confluence";

const JiraModalImport = React.forwardRef<
  {},
  {
    token: string
  } & ModalProps
>(({ token, ...props }, ref) => {
  React.useImperativeHandle(ref, () => ({}), [])
  const importPreviewRef = React.useRef(null)
  const [input, setInput] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  const onImportInputKeydown = React.useCallback((evt) => {
    const isCollapsed = evt.target.selectionEnd === evt.target.selectionStart
    if (isCollapsed && isHotKey('tab', evt)) {
      document.execCommand('insertText', false, '  ')
      evt.preventDefault()
    }
  }, [])
  const jiraApi = React.useMemo(
    () =>
      new JiraApiBrowser({
        password: token
      }),
    [token]
  )

  const userFetcher = async (val) => {
    const res = await jiraApi.querySuggestUsers({
      query: val
    })
    return res.data.users.map((user) => {
      return {
        label: (
          <span className={c('__user-item')}>
            <Avatar style={{ width: 20, height: 20, marginRight: 4 }} src={user.avatarUrl} />
            <span
              style={{ width: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}
              dangerouslySetInnerHTML={{ __html: user.html }}
            />
          </span>
        ),
        value: user.key
      }
    }, {})
  }

  const [form] = Form.useForm()
  const [sprintData, setSprintData] = React.useState({})

  const sprintFetcher = React.useCallback(async (val) => {
    const renderOption = (d: any) => {
      return {
        value: d.id,
        label: (
          <span>
            <span>{d.name} </span>
            <span style={{ color: '#ccc' }}>({d.stateKey})</span>
          </span>
        )
      }
    }
    const res = await jiraApi.querySuggestSprints({
      query: val
    })

    const { suggestions, allMatches } = res.data || {}
    return {
      建议: suggestions.map(renderOption),
      全部: allMatches.map(renderOption)
    }
  }, [])
  React.useEffect(() => {
    // const fetchInitialData = async () => {
    //   const data = await sprintFetcher('')
    //   setSprintData(data)
    //
    //   if (data.建议[0]) {
    //     form.setFieldsValue({
    //       sprint: data.建议[0].value
    //     })
    //   }
    // }
    //
    // fetchInitialData()
  }, [form, sprintFetcher])

  return (
    <Modal
      maskClosable={false}
      className={c()}
      title={'导入jira'}
      {...props}
      confirmLoading={loading}
      onOk={async (e) => {
        const mdast = importPreviewRef.current?.mdast
        if (mdast) {
        }

        const nodes = mdastToTreeNodes(mdast)
        console.log(mdast, nodes)

        const getReqBody = (nodes: TreeNode[]) => ({
          ...form.getFieldsValue(),
          tasksBody: nodes.map((node) => ({
            ...node.data.params,
            // estimate?: number
            summary: node.value,
            description: treeNodesToConfluence(node.children)
          }))
        })

        setLoading(true)
        const parentRes = await jiraApi.createIssues(getReqBody(nodes), { toastSuccess: false })

        if (parentRes.data.issues && parentRes.data.issues.length) {
          const subTasks = []
          parentRes.data.issues.forEach((issue, i) => {
            subTasks.push(
              ...nodes[i].children.map((node) => {
                node.data.params = {
                  ...node.data.params,
                  parent: {
                    key: issue.key
                  },
                  issuetype: {
                    name: '子任务'
                  },
                  // 子任务不能存在以下属性
                  dod: undefined,
                  sprint: undefined,
                  epicLink: undefined
                }
                return node
              })
            )
          })

          let issues = parentRes.data.issues
          if (subTasks.length) {
            const subTasksRes = await jiraApi.createIssues(getReqBody(subTasks), { toastSuccess: false })
            issues = parentRes.data.issues.concat(subTasksRes.data.issues || [])
          }

          const string = issues.map((x) => x.key).join(',')
          notification.success({
            duration: 0,
            message: '创建 Jira Issue 成功',
            description: (
              <Typography.Link
                href={url.format({
                  pathname: '/issues/',
                  query: { jql: `key in (${string})` }
                })}
                target={'_blank'}
              >
                {string}
              </Typography.Link>
            )
          })
        }

        setLoading(false)
      }}
      width={1200}
    >
      <Spin size={'large'} spinning={loading}>
        <Form
          initialValues={{
            dod: '10241'
          }}
          className={c('__common-form')}
          form={form}
          labelCol={{ style: { width: 100 } }}
        >
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item label="Sprint" name="sprint">
                <JiraSuggest group data={sprintData} onDataChange={setSprintData} fetcher={sprintFetcher} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={24}>
            <Col span={12}>
              <Form.Item label="Epic Link" name="epicLink">
                <JiraSuggest
                  group
                  fetcher={async (val) => {
                    const res = await jiraApi.querySuggestEpics({
                      searchQuery: val
                    })
                    return res.data.epicLists.reduce((acc, group) => {
                      acc[group.listDescriptor] = group.epicNames.map((d) => {
                        return {
                          label: (
                            <span>
                              <span>{d.name} - </span>
                              <span style={{ color: '#ccc' }}>({d.key})</span>
                            </span>
                          ),
                          value: d.key
                        }
                      })
                      return acc
                    }, {})
                  }}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={24}>
            <Col span={8}>
              <Form.Item label={'优先级'} name={'priority'}>
                <Select>
                  <Select.Option value={'High'}>High</Select.Option>
                  <Select.Option value={'Medium'}>Medium</Select.Option>
                  <Select.Option value={'Low'}>Low</Select.Option>
                </Select>
              </Form.Item>
            </Col>

            <Col span={8}>
              <Form.Item label={'DoD'} name={'dod'}>
                <Select allowClear>
                  <Select.Option value={'-1'}>无</Select.Option>
                  <Select.Option value={'10241'}>上线</Select.Option>
                  <Select.Option value={'10242'}>上线并隐藏入口</Select.Option>
                  <Select.Option value={'10243'}>上测试</Select.Option>
                  <Select.Option value={'10243'}>及时上线</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={24}>
            <Col span={8}>
              <Form.Item label="经办人" name="assignee">
                <JiraSuggest fetcher={userFetcher} />
              </Form.Item>
            </Col>

            <Col span={8}>
              <Form.Item label="报告人" name="reporter">
                <JiraSuggest fetcher={userFetcher} />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        <div style={{ marginBottom: 10 }}>
          <span style={{ fontSize: 17, fontWeight: 'bold', marginRight: 6 }}>Issue 录入</span>
          <Typography.Link
            href={'https://confluence.zhenguanyu.com/pages/viewpage.action?pageId=127662878'}
            target={'_blank'}
          >
            格式说明
          </Typography.Link>
        </div>
        <div className={c('__import-wrapper')}>
          <Input.TextArea
            onKeyDown={onImportInputKeydown}
            value={input}
            onChange={(event) => {
              setInput(event.target.value)
            }}
            placeholder={'输入 markdown 或者复制 石墨文档内容至此'}
            className={c('__import-left')}
            onPaste={(evt) => {
              const html = evt.clipboardData.getData('text/html')
              if (html) {
                const treeNode = parseHtmlTreeNode(html)
                if (treeNode !== false) {
                  const mdast = treeNodeToMdast(treeNode)
                  const mdText = mdastStringify(mdast)
                  console.log({ mdast, mdText, treeNode })
                  evt.preventDefault()
                  document.execCommand('insertText', false, mdText)
                }
              }
            }}
            cols={12}
          />
          <div className={c('__import-right')}>
            <JiraImportPreview ref={importPreviewRef} markdown={input || ''} />
          </div>
        </div>
      </Spin>
    </Modal>
  )
})

export default JiraModalImport
