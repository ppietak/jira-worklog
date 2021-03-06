const Config = require('./cli/config');

const prompts = require('./cli/input/prompts');
const logger = require('./cli/output/logger');

const JiraExtension = require('../extension/jira');
const GitExtension = require('../extension/git');

const configure = async () => {
  if (!Config.hasHost()) {
    await prompts.askForHost().then(host => Config.setHost(host));
    return false;
  }

  if (!Config.hasAccount()) {
    await prompts.askForAccount().then(account => Config.setAccount(account));
    await prompts.askForPassword().then(password => Config.setPassword(password));
    return false;
  }

  if (!Config.hasProject()) {
    await prompts.askForProject().then(project => Config.setProject(project));
    return false;
  }

  const valid = await JiraExtension.checkCredentials(
    Config.getHost(),
    Config.getAccount(),
    await Config.getPassword()
  );

  if (!valid && Config.hasHost()) {
    await Config.clear().then(() => logger.error('Credentials are invalid. Please try again.'));
  }

  return valid;
};

const run = async () => {
  /* eslint-disable no-await-in-loop */
  while (!(await configure())) {
    await configure();
  }

  const Jira = JiraExtension.initialize(
    Config.getHost(),
    Config.getAccount(),
    await Config.getPassword()
  );

  const chosenDay = await prompts.promptDay();

  const tasks = await Promise
    .all([
      GitExtension.getSuggestedTaskKeys(Config.getProject(), chosenDay),
      Jira.getSuggestedTaskKeys(Config.getProject(), chosenDay),
    ])
    .then(([gitKeys, jiraKeys]) => {
      const allKeys = [...gitKeys, ...jiraKeys];
      return Jira.findTasksWithKeys(allKeys).then(items => ({
        Git: items
          .filter(task => gitKeys.indexOf(task.key) !== -1)
          .map(task => `${task.key} - ${task.name}`),
        Jira: items
          .filter(task => jiraKeys.indexOf(task.key) !== -1)
          .map(task => `${task.key} - ${task.name}`),
      }));
    });

  const hoursAlready = Jira
    .getWorklogs(Config.getProject(), chosenDay)
    .then(worklogs => worklogs.reduce((sum, worklog) => sum + worklog.hours, 0));

  const chosenTask = await prompts.promptTask(chosenDay, tasks);
  if (chosenTask === null) {
    logger.error('Could not find any task to choose from.');
    return;
  }

  const hours = Array.from({ length: Config.getHoursPerDay() }, (x, i) => i + 1).reverse();
  const chosenHours = await prompts.promptHours(hours.map(n => `${n}h`), await hoursAlready || Config.getHoursPerDay());

  const confirmed = await prompts.promptConfirmation(chosenHours, chosenTask);
  if (confirmed) {
    await Jira.sendWorklog(chosenDay, chosenTask, chosenHours);
    logger.info(`Successfully logged ${chosenHours}h of work.`);
  } else {
    logger.info('Ok, aborted.');
  }
};

const phrase = process.argv.slice(2).join(' ').trim();

switch (phrase) {
  case '--reset':
    Config.clear().then(() => logger.info('All cleared.'));
    break;
  default:
    run().catch(() => logger.error('An error occured. Please try again or contact the author. Sorry!'));
}
