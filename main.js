const Apify = require('apify');
const schoolId = process.env.school_id;
const username = process.env.username;
const password = process.env.password;
const stamLectioUrl = 'https://www.lectio.dk/lectio/';

Apify.main(async () => {
        console.log(schoolId + "_" + username);
        const requestQueue = await Apify.openRequestQueue();
        await requestQueue.addRequest({ uniqueKey: schoolId + "_" + username, url: 'https://www.lectio.dk/lectio/' + schoolId + '/login.aspx', userData: {label: "login", login: username, school_id: schoolId, password: password, counter: 0} });

        const crawler = new Apify.PuppeteerCrawler({
            requestQueue,
            // Stop crawling after several pages
            maxRequestsPerCrawl: 15,
            handlePageTimeoutSecs: 60,            
            handlePageFunction: async ({ request, page }) => {
                console.log(`On page: ${request.url}...`);                
                
                if (request.userData.label == "login") {
                    console.log("On login page");                    
                    
                    await page.type('#username', request.userData.login);
                    await page.type('#password', request.userData.password);
              
                    console.log("Submit login");
                    await Promise.all([
                        page.click('#m_Content_submitbtn2'),
                        page.waitForNavigation()	
                    ]);        
                    console.log("Login OK");
                    const teacherId = await page.evaluate(() => {
                        var loginErrorSpan = $('#MainTitle');
                        if (loginErrorSpan != undefined && loginErrorSpan.text().indexOf("Log ind") !== -1) {
                            // skip this login, log error and continue to next login                
                            return false;
                        } else {
                            return $('#s_m_HeaderContent_MainTitle').attr("data-lectiocontextcard").substr(1);
                        }
                    });

                    if (teacherId === false) {
                        console.log("LOGIN FAILED, skipping: " + request.userData.school_id + "_" + request.userData.login);
                        await Apify.pushData({failedLogin: request.userData.school_id + "_" + request.userData.login });
                        return;
                    }                   
                    
                    const schemalink = await Apify.utils.enqueueLinks({
                        page,
                        requestQueue,
                        selector: '#s_m_HeaderContent_subnavigator_ctl02',
                        transformRequestFunction: req => {
                            req.userData.label = "schema";
                            req.userData.school_id = request.userData.school_id;
                            req.userData.login = request.userData.login;                            
                            req.userData.counter = request.userData.counter + 1;                            
                            return req;
                        }
                    });

                    console.log("Enqueued first schema");                    
                }
                if (request.userData.label == "schema") {
                    console.log("On schema page, collecting bricks...");                                        
                                        
                    const scrapeBricks = $bricks => {                    
                        const data = [];                        
                        const totalresult = [];
                        
                        for (var k = 0, len = $bricks.length; k < len; k++) {                        
                                let brick = $bricks[k];
                                let brickJquery = $(brick);
                                
                                let brickData = {classes: [], teachers: [], rooms: [], descriptions: [], custombrick: false};
                                                                
                                // add classes info
                                let classes = brickJquery.find("span[data-lectiocontextcard*=HE]");
                                
                                for (let n = 0; n < classes.length; n++) {
                                    brickData.classes.push(classes[n].textContent);
                                }

                                // add teachers
                                let teachers = brickJquery.find("span[data-lectiocontextcard*=T]");
                                for (let j = 0; j < teachers.length; j++) {
                                    brickData.teachers.push(teachers[j].textContent);
                                }

                                // add room info 
                                let brickContent = brickJquery.find(".s2skemabrikcontent");                                   
                                let roomText = brickContent.contents().filter(function(i, el){ 
                                    return el.nodeType == 3 && el.nodeValue.trim().replace(String.fromCharCode(10), "").replace(String.fromCharCode(8203), "").replace("...","").length > 0; 
                                }).text();
                                
                                brickData.rooms.push(roomText);

                                // add brick description
                                let descriptionSpan = brickJquery.find("span[style]:first-child");
                                let descriptionNotInTags = brickJquery.find("span:not([data-lectiocontextcard])").text();
                                if (descriptionNotInTags.length > 0 && descriptionSpan.length == 0) {
                                    brickData.descriptions.push(descriptionNotInTags);
                                }
                                else if (descriptionSpan.text().trim() != "") {
                                    brickData.custombrick = true;
                                    brickData.descriptions.push(descriptionSpan.text().trim());
                                }
                                
                                // add additional-info attribute text 
                                let title = brick.getAttribute('rel');
                                if (title === undefined || title === null) {
                                    title = brick.getAttribute('data-additionalinfo');
                                }                                                               

                                totalresult.push({title: title, data: brickData});                        
                        }
                        
                        data.push(totalresult);        
                        return data;
                    }                    

                    const databricks = await page.$$eval('#s_m_Content_Content_SkemaNyMedNavigation_skema_skematabel > tbody > tr:nth-child(4) .s2skemabrik', scrapeBricks);                    
                    const userKey = request.userData.school_id + "_" + request.userData.login;                    
                    const userDataBricks = {};
                    userDataBricks[userKey] = databricks;
                    
                    await Apify.pushData(userDataBricks);
                    console.log("Bricks collected");
                    
                    if (request.userData.counter < 3) {                                                
                        console.log("Enqueueing schema");
                        const infos = await Apify.utils.enqueueLinks({
                            page,
                            requestQueue,
                            selector: '#s_m_Content_Content_SkemaNyMedNavigation_datePicker_nextLnk',
                            transformRequestFunction: req => {
                                req.userData.label = "schema";
                                req.userData.school_id = request.userData.school_id;
                                req.userData.login = request.userData.login;                                
                                req.userData.counter = request.userData.counter + 1;                                
                                return req;
                            }
                        });                
                    }                    
                }        
            },        
            // This function is called if the page processing failed more than maxRequestRetries+1 times.
            handleFailedRequestFunction: async ({ request }) => {
                console.log(`Request ${request.url} failed too many times`);
                await Apify.pushData({
                    '#debug': Apify.utils.createRequestDebugInfo(request),
                });
            },
        });
    await crawler.run();
    
    console.log('All good, we\'re done here captain.');
});