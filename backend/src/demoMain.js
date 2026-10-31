process.env.BOT_MODE='FUTURES_DEMO';
require('./index').main().catch(error=>{console.error(error.message);process.exitCode=1;});
