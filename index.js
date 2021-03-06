const ApiGateway = require('./app/http-gateway')
const Cache = require('./app/cache')

/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Application} app
 */
const robokit = app => {
  const cache = new Cache(app)

  app.log('Starting the TxBot service.')
  const api = new ApiGateway(app, cache)

  app.on('schedule.repository', async context => {
    cache.set(context.payload.repository.owner.login, context.payload.repository.name, context.github)
    api.installPipeline(context.payload.repository.owner.login, context.payload.repository.name)
  })

  app.on('installation', context => {
    api.onAppInstall(context)
    console.log('installation event:' + JSON.stringify(context))
  })

  app.on('check_run', context => {
    if(context.payload.requested_action){
      let action = context.payload.requested_action.identifier
      context.user_action = action
    }
    api.onCheckRun(context)
  })

  app.on([
    // 'pull_request.synchronize',
    // 'pull_request.labeled',
    // 'pull_request.opened',
    // 'pull_request.reopened',
    'pull_request.unlabeled',
    'pull_request.closed'
  ], context => {
    return api.onPullRequest(context)
  })

  app.on([
    'issue_comment',
    'issues',
    'push'], async context => {
    // api.route(context);
  })

  console.log('Server Started.')

  if(process.env.SUBDOMAIN){
    const SmeeClient = require('smee-client')

    const smee = new SmeeClient({
      source: `https://smee.io/${process.env.SUBDOMAIN}`,
      target: `http://localhost:${process.env.PORT}`,
      logger: console
    })

    const events = smee.start()
  }
}
module.exports = robokit









// For more information on building apps:
// https://probot.github.io/docs/

// To get your app running against GitHub, see:
// https://probot.github.io/docs/development/
// Authenticate as the App