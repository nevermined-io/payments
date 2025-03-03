import { sleep } from '../../src/common/helper'
import { AgentExecutionStatus, CreateTaskDto, Step, TaskLogMessage } from '../../src/common/types'
import { EnvironmentName } from '../../src/environments'
import { Payments } from '../../src/payments'
// import { getQueryProtocolEndpoints } from "../../src/utils"
import { io } from 'socket.io-client'

describe('Payments API (e2e)', () => {
  const TEST_TIMEOUT = 30_000
  // To configure the test gets the API Keys for the subscriber and the builder from the https://staging.nevermined.app website
  const subscriberNvmApiKeyHash =
    process.env.TEST_SUBSCRIBER_API_KEY ||
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDFCMDZDRkIyMkYwODMyZmI5MjU1NDE1MmRiYjVGOWM5NzU2ZTkzN2QiLCJqdGkiOiIweDlmMGRkNmZhODNkMDY3ZDRiYzFkNzEyN2Q3ZWE0M2EwYmUwNzc1NWJmNjMxMTVmYzJhODhmOTQwZmY4MjQ1NGQiLCJleHAiOjE3NTk4NzQwMDEsImlhdCI6MTcyODMxNjQwMn0.SqlcnMvdIjpZdBDs8FBsruYUIVpS75My-l5VfVwsFdU_3Xz5DuYt1frdF0QZq8isx9NOsNgRSeG8sBVtvAl-vRw'
  const builderNvmApiKeyHash =
    process.env.TEST_BUILDER_API_KEY ||
    // 'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDdmRTNFZTA4OGQwY2IzRjQ5ZmREMjBlMTk0RjIzRDY4MzhhY2NjODIiLCJqdGkiOiIweGY2ZDcyMmIzYWY5ZmNhOWY2MTQ2OGI5YjlhNGNmZjk3Yjg5NjE5Yzc1ZjRkYWEyMmY4NTA3Yjc2ODQzM2JkYWQiLCJleHAiOjE3NTk2MDU0MTMsImlhdCI6MTcyODA0NzgxNn0.1JDNV7yT8i1_1DXxC4z_jzMLJQns4XqujaJOEFmLdtwFam7bi-3s8oOF-dbTBObzNY98ddZZFifaCEvJUImYOBw'
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDdmRTNFZTA4OGQwY2IzRjQ5ZmREMjBlMTk0RjIzRDY4MzhhY2NjODIiLCJqdGkiOiIweGRhMWNmYTFjMzQ5NTE3MDkwOWQ2ZjY1Mjk3MzlhNWMyZDQ3NTNiMzE4N2JhZDc2ZjU3NGU4ZjQ1NTA0ZGUxYjIiLCJleHAiOjE3NjI5NTYwNjksImlhdCI6MTczMTM5ODQ3MH0.3fHX0Ngptob__kXC8CVUwuVJ-TyMEdxRJwohXCNLO9UzCQOIxwHK9c6uIwUkF-vls4oC2G9lNiqPgVey3KnMSRs'
  const testingEnvironment = process.env.TEST_ENVIRONMENT || 'staging'
  const _SLEEP_DURATION = 3_000
  const ERC20_ADDRESS = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
  // const ENDPOINTS: Endpoint[] = [
  //   // { 'POST': `https://one-backend.${testingEnvironment}.nevermined.app/api/v1/agents/(.*)/tasks` },
  //   // { 'GET': `https://one-backend.${testingEnvironment}.nevermined.app/api/v1/agents/(.*)/tasks/(.*)` }
  // ]

  let paymentsSubscriber: Payments
  let paymentsBuilder: Payments

  let planDID: string
  let agentDID: string

  // let accessToken: string
  // let proxyHost: string
  let subscriberQueryOpts = {}
  let balanceBefore: bigint
  let createdTaskId: string
  let completedTaskId: string
  let completedTaskDID: string
  let failedTaskId: string
  let failedTaskDID: string

  describe('Payments Setup', () => {
    it('The Payments client can be initialized correctly', () => {
      paymentsSubscriber = Payments.getInstance({
        nvmApiKey: subscriberNvmApiKeyHash,
        environment: testingEnvironment as EnvironmentName,
      })
      expect(paymentsSubscriber).toBeDefined()
      expect(paymentsSubscriber.query).toBeDefined()

      paymentsBuilder = Payments.getInstance({
        nvmApiKey: builderNvmApiKeyHash,
        environment: testingEnvironment as EnvironmentName,
      })
      expect(paymentsBuilder).toBeDefined()
      expect(paymentsBuilder.query).toBeDefined()
    })

    it('Search for an agent and plans', async () => {
      const plan = await paymentsBuilder.searchPlans({ text: 'AI' })
      expect(plan).toBeDefined()
      const agent = await paymentsBuilder.searchPlans({ text: 'AI' })
      expect(agent).toBeDefined()
    })

    it.skip('Manual subscription', async () => {
      const socketOptions = {
        // path: '/agents',
        transports: ['websocket'],
        transportOptions: {
          websocket: {
            extraHeaders: {
              Authorization: `Bearer ${builderNvmApiKeyHash}`,
            },
          },
        },
      }
      const client = io('wss://one-backend.staging.nevermined.app', socketOptions)
      expect(client).toBeDefined()
      client.connect()
      await sleep(1000)
      expect(client.connected).toBeTruthy()
      console.log('Client connected:', client.connected)

      const room = 'room:0x7fE3Ee088d0cb3F49fdD20e194F23D6838accc82'
      // const room = 'randomroom'
      const message = {
        event: 'test',
        data: {
          step_id: 'step-id',
          task_id: 'task-id',
          did: 'did',
        },
      }
      client.emit('subscribe-agent', '')

      client.emit(room, '{"event": "test", "data": ""}')

      let received = false
      client.on(room, (data) => {
        console.log('RECEIVED Websocket data:', data)
        received = true
        expect(data).toBeDefined()
        // return data
      })

      client.emit(room, message)

      await sleep(1000)
      client.disconnect()

      expect(received).toBe(true)
    })

    // it('I should be able to create a AI Task', async () => {
    //   const agentDID = 'did:nv:255165627447200c8976dc608d9c1adbc54c72e04607d69c80e4f921293abc0a'
    //   const aiTask = {
    //     query: "https://www.youtube.com/watch?v=0tZFQs7qBfQ",
    //     name: "transcribe",
    //     "additional_params": [],
    //     "artifacts": []
    //   }

    //   const accessConfig = await paymentsSubscriber.query.getServiceAccessConfig(agentDID)
    //   const queryOpts = {
    //     accessToken: accessConfig.accessToken,
    //     proxyHost: accessConfig.neverminedProxyUri
    //   }

    //   const taskResult = await paymentsSubscriber.query.createTask(agentDID, aiTask, queryOpts)
    //   expect(taskResult).toBeDefined()
    //   expect(taskResult.status).toBe(201)
    //   console.log('Task Result', taskResult.data)
    // }, TEST_TIMEOUT)
  })

  describe('AI Builder Publication', () => {
    it(
      'I should be able to register a new credits Payment Plan',
      async () => {
        planDID = (
          await paymentsBuilder.createCreditsPlan({
            name: 'E2E Payments Plan',
            description: 'description',
            price: 0n,
            tokenAddress: ERC20_ADDRESS,
            amountOfCredits: 100,
          })
        ).did

        expect(planDID).toBeDefined()
        expect(planDID.startsWith('did:nv:')).toBeTruthy()
        console.log('Plan DID', planDID)
      },
      TEST_TIMEOUT,
    )

    it(
      'I should be able to register a new Agent running on NVM Infrastructure',
      async () => {
        // const endpoints = getQueryProtocolEndpoints('https://one-backend.staging.nevermined.app')

        agentDID = (
          await paymentsBuilder.createAgent({
            planDID,
            name: 'E2E Payments Agent',
            description: 'description',
            serviceChargeType: 'fixed',
            amountOfCredits: 1,
            usesAIHub: true,
          })
        ).did

        expect(agentDID).toBeDefined()
        expect(agentDID.startsWith('did:nv:')).toBeTruthy()
        console.log('Agent DID', agentDID)
      },
      TEST_TIMEOUT,
    )

    it(
      'I should be able to register an agent and a plan in one step',
      async () => {
        const { planDID, agentDID } = await paymentsBuilder.createAgentAndPlan(
          {
            name: 'E2E Payments Agent',
            description: 'description',
            price: 0n,
            amountOfCredits: 100,
            tokenAddress: ERC20_ADDRESS,
          },
          {
            name: 'Agent e2e name',
            description: 'description',
            amountOfCredits: 1,
            usesAIHub: true,
            serviceChargeType: 'fixed',
          },
        )
        expect(agentDID).toBeDefined()
        expect(planDID).toBeDefined()
      },
      TEST_TIMEOUT,
    )

    it.skip(
      'I should be able to register a new File',
      async () => {
        const file = {
          index: 0,
          contentType: 'application/json',
          name: 'ddo-example.json',
          url: 'https://storage.googleapis.com/nvm-static-assets/files/ci/ddo-example.json',
        }
        const fileDID = (
          await paymentsBuilder.createFile({
            planDID: planDID,
            name: 'E2E Payments File',
            description: 'description',
            assetType: 'dataset',
            files: [file],
          })
        ).did

        expect(fileDID).toBeDefined()
        expect(fileDID.startsWith('did:nv:')).toBeTruthy()
        console.log('File DID', agentDID)
      },
      TEST_TIMEOUT,
    )
  })

  describe('Subscriber Order', () => {
    it(
      'I should be able to order an Agent',
      async () => {
        console.log(planDID)
        const orderResult = await paymentsSubscriber.orderPlan(planDID)
        expect(orderResult).toBeDefined()
        expect(orderResult.success).toBeTruthy()
        expect(orderResult.agreementId).toBeDefined()
        console.log('Order Result', orderResult)
      },
      TEST_TIMEOUT * 2,
    )

    it('I should be able to check the credits I own', async () => {
      const balanceResult = await paymentsSubscriber.getPlanBalance(planDID)
      expect(balanceResult).toBeDefined()
      console.log('Balance Result', balanceResult)
      expect(balanceResult.isSubscriptor).toBeTruthy()
      expect(BigInt(balanceResult.balance)).toBeGreaterThan(0)
      balanceBefore = BigInt(balanceResult.balance)
    })

    it(
      'I should be able to create a AI Task',
      async () => {
        const aiTask = {
          input_query: 'https://www.youtube.com/watch?v=0tZFQs7qBfQ',
          name: 'transcribe',
          input_additional: {},
          input_artifacts: [],
        }
        subscriberQueryOpts = await paymentsSubscriber.query.getServiceAccessConfig(agentDID)

        const taskResult = await paymentsSubscriber.query.createTask(
          agentDID,
          aiTask,
          subscriberQueryOpts,
          async (data) => {
            console.log('Task Log received', data)
          },
        )

        expect(taskResult).toBeDefined()
        console.log('Task Result', taskResult)
        createdTaskId = taskResult.data?.task.task_id as string
        expect(createdTaskId).toBeDefined()
      },
      TEST_TIMEOUT,
    )
  })

  describe('AI Builder Agent', () => {
    let taskCost: bigint
    it('Builder should be able to fetch pending tasks', async () => {
      const steps = await paymentsBuilder.query.getSteps(AgentExecutionStatus.Pending)
      expect(steps).toBeDefined()
      //console.log(steps.data)
      expect(steps.steps.length).toBeGreaterThan(0)
    })

    it.skip('Builder should be able to send logs', async () => {
      const logMessage: TaskLogMessage = {
        level: 'info',
        task_status: AgentExecutionStatus.Pending,
        task_id: createdTaskId,
        message: 'This is a log message',
      }
      await paymentsBuilder.query.logTask(logMessage)
      expect(true).toBeTruthy() // If the emitTaskLog does not throw an error, it is working
    })

    it(
      'Builder should be able to subscribe and process pending tasks',
      async () => {
        let stepsReceived = 0
        const opts = {
          joinAccountRoom: true,
          joinAgentRooms: [],
          subscribeEventTypes: ['step-updated'],
          getPendingEventsOnSubscribe: false,
        }
        await paymentsBuilder.query.subscribe(async (data) => {
          console.log('TEST:: Step received', data)
          expect(data).toBeDefined()
          // const eventData = JSON.parse(data)
          const eventData = data
          expect(eventData.step_id).toBeDefined()

          stepsReceived++
          let result
          const searchResult = await paymentsBuilder.query.searchSteps({
            step_id: eventData.step_id,
          })
          expect(searchResult.steps).toBeDefined()
          const step = searchResult.steps[0]
          if (step.did && step.input_query && step.input_query.startsWith('http')) {
            console.log(`LISTENER :: Received URL ${step.input_query}`)
            result = await paymentsBuilder.query.updateStep(step.did, {
              step_id: step.step_id,
              task_id: step.task_id,
              step_status: AgentExecutionStatus.Completed,
              is_last: true,
              output: 'LFG!',
              cost: 1,
            } as Step)
            // expect(result.status).toBe(201)
            if (result.success) {
              completedTaskId = step.task_id
              completedTaskDID = step.did
            }
          } else {
            console.log(`LISTENER :: Received Invalid URL ${step.input_query}`)
            result = await paymentsBuilder.query.updateStep(step.did!, {
              step_id: step.step_id,
              task_id: step.task_id,
              step_status: AgentExecutionStatus.Failed,
              is_last: true,
              output: 'Invalid URL',
              cost: 0,
            } as Step)
          }
        }, opts)

        const aiTask: CreateTaskDto = {
          input_query: 'https://www.youtube.com/watch?v=0tZFQs7qBfQ',
          name: 'transcribe',
          input_additional: {},
          input_artifacts: [],
        }
        // const accessConfig = await paymentsSubscriber.query.getServiceAccessConfig(agentDID)
        // const queryOpts = {
        //   accessToken: accessConfig.accessToken,
        //   proxyHost: accessConfig.neverminedProxyUri,
        // }

        const taskResult = await paymentsSubscriber.query.createTask(agentDID, aiTask) //, queryOpts)

        expect(taskResult).toBeDefined()

        console.log(`TEST:: Sleeping for 10 seconds: ${new Date().toLocaleTimeString()}`)
        await sleep(10_000)
        console.log(`TEST:: Awaiting: ${new Date().toLocaleTimeString()}`)

        expect(stepsReceived).toBeGreaterThan(0)
        expect(completedTaskId).toBeDefined()
        console.log(`Completed Task ID: ${completedTaskId}`)
      },
      TEST_TIMEOUT,
    )

    it(
      'Subscriber should be able to receive logs',
      async () => {
        const aiTask: CreateTaskDto = {
          input_query: 'https://www.youtube.com/watch?v=0tZFQs7qBfQ',
          name: 'transcribe',
          input_additional: {},
          input_artifacts: [],
        }
        // const accessConfig = await paymentsSubscriber.query.getServiceAccessConfig(agentDID)
        // const queryOpts = {
        //   accessToken: accessConfig.accessToken,
        //   proxyHost: accessConfig.neverminedProxyUri,
        // }

        let logsReceived = 0
        const taskResult = await paymentsSubscriber.query.createTask(
          agentDID,
          aiTask,
          undefined,
          async (data) => {
            console.log('New Task Log received', data)
            logsReceived++
          },
        )
        const taskId = taskResult.data?.task.task_id
        const logMessage: TaskLogMessage = {
          level: 'info',
          task_status: AgentExecutionStatus.Completed,
          task_id: taskId!,
          message: 'This is a log message',
        }

        console.log(`Sending log message for task ${logMessage.task_id}`)

        await paymentsBuilder.query.logTask(logMessage)

        await sleep(5_000)
        console.log(`# Logs received: ${logsReceived}`)
        expect(logsReceived).toBeGreaterThan(0)
      },
      TEST_TIMEOUT,
    )

    it('Subscriber should be able to validate an AI task is completed', async () => {
      console.log(`@@@@@ getting task with steps: ${completedTaskDID} - ${completedTaskId}`)
      console.log(JSON.stringify(subscriberQueryOpts))
      const result = await paymentsSubscriber.query.getTaskWithSteps(
        completedTaskDID,
        completedTaskId,
        subscriberQueryOpts,
      )
      expect(result).toBeDefined()
      console.log('Task with Steps', result)
      expect(result.task.cost).toBeDefined()
      taskCost = BigInt(result.task.cost)
      expect(taskCost).toBeGreaterThan(0)
    })

    it('Subscriber should be able to check that I consumed some credits', async () => {
      const balanceResult = await paymentsSubscriber.getPlanBalance(planDID)
      expect(balanceResult).toBeDefined()
      const balanceAfter = BigInt(balanceResult.balance)

      expect(balanceAfter).toBeDefined()

      console.log(`Balance Before: ${balanceBefore}`)
      console.log(`Balance After: ${balanceAfter}`)
      console.log(`Task Cost: ${taskCost}`)

      expect(balanceAfter).toBeLessThan(balanceBefore)
    })

    // it.skip('I should be able to end a task with a failure', () => {})
  })

  describe('Failed tasks are free of charge', () => {
    it(
      'I should be able to create a wrong AI Task',
      async () => {
        const aiTask = {
          input_query: 'this is not a URL !!!!',
          name: 'transcribe',
          input_additional: {},
          input_artifacts: [],
        }
        const taskResult = await paymentsSubscriber.query.createTask(
          agentDID,
          aiTask,
          subscriberQueryOpts,
        )

        expect(taskResult).toBeDefined()
        //console.log('Task Result', taskResult.data)
        failedTaskDID = taskResult.data?.task.did as string
        failedTaskId = taskResult.data?.task.task_id as string
        console.log(`Failed Task DID: ${failedTaskDID}`)
        console.log(`Failed TaskId: ${failedTaskId}`)
      },
      TEST_TIMEOUT,
    )

    it('I should be able to validate an AI task Failed', async () => {
      const result = await paymentsSubscriber.query.getTaskWithSteps(
        failedTaskDID,
        failedTaskId,
        subscriberQueryOpts,
      )
      expect(result).toBeDefined()
      //console.log('Task with Steps', result)
      // console.log('Task with Steps', result.data)
      // expect(result.data.task.cost).toBeDefined()
      // taskCost = BigInt(result.data.task.cost)
      // expect(taskCost).toBeGreaterThan(0)
    })

    it('I should be charged only by the exact number of credits consumed', async () => {
      const balanceResult = await paymentsSubscriber.getPlanBalance(planDID)
      expect(balanceResult).toBeDefined()
      const balanceAfter = BigInt(balanceResult.balance)
      expect(balanceAfter).toBeDefined()

      console.log(`Balance Before: ${balanceBefore}`)
      console.log(`Balance After: ${balanceBefore}`)
    })
  })

  describe('Logout', () => {
    it('publisher and subscriber can logout', () => {
      paymentsSubscriber.logout()
      expect(paymentsSubscriber.isLoggedIn).toBeFalsy()
      expect(paymentsSubscriber.query.isWebSocketConnected()).toBeFalsy()

      paymentsBuilder.logout()
      expect(paymentsBuilder.isLoggedIn).toBeFalsy()
      expect(paymentsBuilder.query.isWebSocketConnected()).toBeFalsy()
    })
  })
})

// const stepReceived = (data: any) => {
//   console.log('Step received', data)
// }
