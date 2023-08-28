import { Parser } from 'json2csv';
import uniswapStrategyBacktest from './uniBackTest.mjs'
import { getPoolHourData } from './uniPoolData.mjs'
import fs from 'fs';

const poolID = "0xdac8a8e6dbf8c690ec6815e0ff03491b2770255d" //USDT/USDC
const investmentAmount = 10000;
const days = 365;
const period = "hourly";
const protocol = 3; // 0 =  Ethereum, 1 = Optimism, 2 = Arbitrum, 3 = Polygon
const percent = 0.0001;
const compoumd = true; // 是否複利

async function runBackTest() {
  const parser = new Parser();

  let endTime = Math.floor(Date.now()/1000/60/60)*60*60;
  let startTime = endTime - days * 24*60*60;
  console.log('startTime: ' + (startTime+1));
  console.log('endTime: ' + endTime);

  let currentTime = startTime;

  let poolHourDatas = [];

  let minRange = 0;
  let maxRange = 0;
  let finalResults = [];
  let index = 0;
  let changeCount = 0;

  let startPeriod = startTime-1;
  let endPeriod = 0;

  let currentAmount = investmentAmount;

  while(poolHourDatas.length == 0  || endTime > poolHourDatas[index-1].periodStartUnix+3600) {

    if (startPeriod > endTime) {
      break;
    }

    let roundStartTime ,roundEndTime;

    if (!roundStartTime) {
      roundEndTime = startPeriod;
    }

    roundStartTime = roundEndTime;
    roundEndTime +=  (25 * 24 * 60 * 60) + 1; 
    if (roundEndTime > endTime) {
      roundEndTime = endTime;
    }

    console.log("fetching data: \n  roundStartTime: " + roundStartTime + "\n  roundEndTime: " + roundEndTime);

    let datas = await getPoolHourData(poolID, roundStartTime, roundEndTime, protocol);
    if (datas.length > 0) {
      datas = datas.reverse()
    }

    poolHourDatas = poolHourDatas.concat(datas);
    if (!minRange) {
      minRange = poolHourDatas[0].close * (1-percent);
      maxRange = poolHourDatas[0].close * (1+percent);
    }

    while(index < poolHourDatas.length) {
      console.log("index: " + index);
      let currentStartTime = poolHourDatas[index].periodStartUnix-1;
      let currentEndTime = poolHourDatas[index].periodStartUnix+3600;

      let forecastMinRange = poolHourDatas[index].close * (1-percent);
      let forecastMaxRange = poolHourDatas[index].close * (1+percent);


      if ((poolHourDatas[index].low > minRange && poolHourDatas[index].low < maxRange) || 
        (poolHourDatas[index].high > minRange && poolHourDatas[index].high < maxRange)) {
        // if price still in the range, do nothing
      } else {
        endPeriod = poolHourDatas[index-1].periodStartUnix+3600
        let backtestResults = await uniswapStrategyBacktest(
            poolID,
            currentAmount,
            minRange,
            maxRange,
            {startTimestamp: startPeriod, endTimestamp: endPeriod, period: period, protocol: protocol}
            //{day: days, period: period, protocol: protocol}
            );


        if (!backtestResults) {
          minRange = forecastMinRange;
          maxRange = forecastMaxRange;
          startPeriod = endPeriod-1;
          changeCount++;
          index++;
          continue;
        }

        currentAmount = backtestResults[backtestResults.length-1].amountV;

        let sumOfFee = 0;
        if (compoumd) {
          backtestResults.forEach(result => {
            sumOfFee += result.feeUSD;
          });
          currentAmount += sumOfFee;
        }

        // 在回測結果中添加 minRange 和 maxRange
        if (backtestResults) {
          backtestResults = backtestResults.map(result => ({...result, minRange, maxRange}));
          finalResults.push.apply(finalResults, backtestResults);
        } 

        minRange = forecastMinRange;
        maxRange = forecastMaxRange;
        startPeriod = endPeriod-1;
        changeCount++;
      }
      
      index++;
    }
  }

  endPeriod = poolHourDatas[poolHourDatas.length - 1].periodStartUnix+3601;
  let backtestResults = await uniswapStrategyBacktest(
      poolID,
      currentAmount,
      minRange,
      maxRange,
      {startTimestamp: startPeriod, endTimestamp: endPeriod, period: period, protocol: protocol}
      //{day: days, period: period, protocol: protocol}
      );

    console.log(backtestResults)
  // 在回測結果中添加 minRange 和 maxRange
  if (backtestResults) {
    backtestResults = backtestResults.map(result => ({...result, minRange, maxRange}));
    finalResults.push.apply(finalResults, backtestResults);
  } 

  // 將回測結果轉換為 CSV 格式
  const csv = parser.parse(finalResults);

  // 將 CSV 內容添加到文件中
  fs.appendFile('backtestResults.csv', csv + '\n', (err) => {
    if (err) throw err;
    console.log('The file has been updated!');
  });

  console.log('changeCount: ' + changeCount);
}

runBackTest();

