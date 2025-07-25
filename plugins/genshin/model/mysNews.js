import base from "./base.js"
import fetch from "node-fetch"
import lodash from "lodash"
import puppeteer from "../../../lib/puppeteer/puppeteer.js"
import common from "../../../lib/common/common.js"
import gsCfg from "../model/gsCfg.js"
import YAML from "yaml"
import fs from "fs"

let emoticon

export default class MysNews extends base {
  constructor(e) {
    super(e)
    this.model = "mysNews"
  }

  async getNews(gid) {
    let type = 1
    let typeName = "公告"
    if (this.e.msg.includes("资讯")) {
      type = "3"
      typeName = "资讯"
    }
    if (this.e.msg.includes("活动")) {
      type = "2"
      typeName = "活动"
    }

    const res = await this.postData("getNewsList", {
      gids: gid,
      page_size: this.e.msg.includes("列表") ? 5 : 20,
      type,
    })
    if (!res) return

    const data = res.data.list
    if (data.length == 0) {
      return true
    }

    let param = {}
    let game = this.game(gid)
    if (this.e.msg.includes("列表")) {
      this.model = "mysNews-list"
      data.forEach(element => {
        element.post.created_at = new Date(element.post.created_at * 1000).toLocaleString()
      })

      param = {
        ...this.screenData,
        saveId: this.e.user_id,
        data,
        game,
        typeName,
      }
    } else {
      const page =
        this.e.msg
          .replace(
            /#|＃|官方|星铁|原神|崩坏三|崩三|绝区零|崩坏二|崩二|崩坏学园二|未定|未定事件簿|公告|资讯|活动/g,
            "",
          )
          .trim() || 1
      if (page > data.length) {
        await this.e.reply("目前只查前20条最新的公告，请输入1-20之间的整数。")
        return true
      }

      const postId = data[page - 1].post.post_id

      param = await this.newsDetail(postId, gid)
    }

    const img = await this.render(param)
    return this.replyMsg(
      img,
      `${game}${typeName}：${param?.data?.post?.subject || `米游社${game}${typeName}列表`}`,
    )
  }

  render(param) {
    return puppeteer.screenshots(this.model, param)
  }

  async newsDetail(postId, gid) {
    const res = await this.postData("getPostFull", { gids: gid, read: 1, post_id: postId })
    if (!res) return

    const data = await this.detalData(res.data.post, gid)

    return {
      ...this.screenData,
      saveId: postId,
      dataConent: data.post.content,
      data,
    }
  }

  postApi(type, data) {
    let host = "https://bbs-api.miyoushe.com/"
    let param = []
    lodash.forEach(data, (v, i) => param.push(`${i}=${v}`))
    param = param.join("&")
    switch (type) {
      // 搜索
      case "searchPosts":
        host = "https://bbs-api.miyoushe.com/post/wapi/searchPosts?"
        break
      case "userInstantSearchPosts":
        host = "https://bbs-api.miyoushe.com/painter/api/user_instant/search/list?"
        break
      // 帖子详情
      case "getPostFull":
        host += "post/wapi/getPostFull?"
        break
      // 公告列表
      case "getNewsList":
        host = "https://bbs-api-static.miyoushe.com/painter/wapi/getNewsList?"
        break
      case "emoticon":
        host += "misc/api/emoticon_set?"
        break
    }
    return host + param
  }

  async postData(type, data) {
    const url = this.postApi(type, data)
    const headers = {
      Referer: "https://www.miyoushe.com",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36",
    }
    let response
    try {
      response = await fetch(url, { method: "get", headers })
    } catch (error) {
      logger.error(error.toString())
      return false
    }

    if (!response.ok) {
      logger.error(`[米游社接口错误][${type}] ${response.status} ${response.statusText}`)
      return false
    }
    const res = await response.json()
    return res
  }

  async detalData(data, gid) {
    let json
    try {
      json = JSON.parse(data.post.content)
    } catch (error) {}

    if (typeof json == "object") {
      if (json.imgs && json.imgs.length > 0) {
        for (const val of json.imgs) {
          data.post.content = ` <div class="ql-image-box"><img src="${val}?x-oss-process=image//resize,s_600/quality,q_80/auto-orient,0/interlace,1/format,png"></div>`
        }
      }
    } else {
      for (const img of data.post.images) {
        data.post.content = data.post.content.replace(
          img,
          img +
            "?x-oss-process=image//resize,s_600/quality,q_80/auto-orient,0/interlace,1/format,jpg",
        )
      }

      if (!emoticon) {
        emoticon = await this.mysEmoticon(gid)
      }

      data.post.content = data.post.content.replace(/_\([^)]*\)/g, function (t, e) {
        t = t.replace(/_\(|\)/g, "")
        if (emoticon.has(t)) {
          return `<img class="emoticon-image" src="${emoticon.get(t)}"/>`
        } else {
          return ""
        }
      })

      const arrEntities = { lt: "<", gt: ">", nbsp: " ", amp: "&", quot: '"' }
      data.post.content = data.post.content.replace(/&(lt|gt|nbsp|amp|quot);/gi, function (all, t) {
        return arrEntities[t]
      })
    }

    data.post.created_time = new Date(data.post.created_at * 1000).toLocaleString()

    for (const i in data.stat) {
      data.stat[i] = data.stat[i] > 10000 ? (data.stat[i] / 10000).toFixed(2) + "万" : data.stat[i]
    }

    return data
  }

  async mysEmoticon(gid) {
    const emp = new Map()

    const res = await this.postData("emoticon", { gids: gid })

    if (res.retcode != 0) {
      return emp
    }

    for (const val of res.data.list) {
      if (!val.icon) continue
      for (const list of val.list) {
        if (!list.icon) continue
        emp.set(list.name, list.icon)
      }
    }

    return emp
  }

  async mysSearch() {
    let msg = this.e.msg
    msg = msg.replace(/#|米游社|mys/g, "")

    if (!msg) {
      await this.e.reply("请输入关键字，如#米游社七七")
      return false
    }

    let page = msg.match(/.*(\d){1}$/) || 0
    if (page && page[1]) {
      page = page[1]
    }

    msg = lodash.trim(msg, page)

    let res = await this.postData("searchPosts", { gids: 2, size: 20, keyword: msg })
    if (!res) return

    if (res?.data?.posts.length <= 0) {
      await this.e.reply("搜索不到您要的结果，换个关键词试试呗~")
      return false
    }

    let postId = res.data.posts[page].post.post_id

    const param = await this.newsDetail(postId)

    const img = await this.render(param)

    return this.replyMsg(img, `${param.data.post.subject}`)
  }

  async mysUrl() {
    let msg = this.e.msg
    let postId = /[0-9]+/g.exec(msg)[0]

    if (!postId) return false

    const param = await this.newsDetail(postId)

    const img = await this.render(param)

    return this.replyMsg(img, `${param.data.post.subject}`)
  }

  async mysEstimate(keyword, uid) {
    let res = await this.postData("userInstantSearchPosts", {
      keyword,
      uid,
      size: 20,
      offset: 0,
      sort_type: 2,
    })
    let postList = res?.data?.list
    if (postList.length <= 0) {
      await this.e.reply("暂无数据")
      return false
    }
    let postId = postList[0].post.post.post_id
    if (!postId) {
      await this.e.reply("暂无数据")
      return false
    }

    const param = await this.newsDetail(postId)

    const img = await this.render(param)

    if (img.length > 1) {
      img.push(
        segment.image(
          param.data.post.images[0] +
            "?x-oss-process=image//resize,s_600/quality,q_80/auto-orient,0/interlace,1/format,jpg",
        ),
      )
    }

    return this.replyMsg(img, `${param.data.post.subject}`)
  }

  replyMsg(img, title) {
    if (!Array.isArray(img)) {
      img = [img]
    }
    if (!img || img.length <= 0) return false
    if (title) img = [title, ...img]
    if (img.length <= 2) return img
    return common.makeForwardMsg(this.e, [img])
  }

  async mysNewsTask() {
    let cfg = gsCfg.getConfig("mys", "pushNews")

    // 推送2小时内的公告资讯活动
    let interval = 7200
    // 最多同时推送两条
    this.maxNum = cfg.maxNum

    for (let gid of [1, 2, 3, 4, 6, 8]) {
      let type =
        gid == 1
          ? "bbb"
          : gid == 2
            ? "gs"
            : gid == 3
              ? "bb"
              : gid == 4
                ? "wd"
                : gid == 6
                  ? "sr"
                  : "zzz"

      let news = []
      if (!lodash.isEmpty(cfg[`${type}announceGroup`])) {
        let anno = await this.postData("getNewsList", { gids: gid, page_size: 10, type: 1 })
        if (anno)
          anno.data.list.forEach(v => {
            news.push({ ...v, typeName: "公告", post_id: v.post.post_id })
          })
      }
      if (!lodash.isEmpty(cfg[`${type}infoGroup`])) {
        let info = await this.postData("getNewsList", { gids: gid, page_size: 10, type: 3 })
        if (info)
          info.data.list.forEach(v => {
            news.push({ ...v, typeName: "资讯", post_id: v.post.post_id })
          })
      }
      if (!lodash.isEmpty(cfg[`${type}activityGroup`])) {
        let acti = await this.postData("getNewsList", { gids: gid, page_size: 10, type: 2 })
        if (acti) 
          acti.data.list.forEach(v => { 
            news.push({ ...v, typeName: "活动", post_id: v.post.post_id }) 
          })
      }

      if (news.length <= 0) continue

      news = lodash.orderBy(news, ["post_id"], ["asc"])

      let now = Date.now() / 1000

      this.key = `Yz:${type}:mys:newPush:`
      this.e.isGroup = true
      this.pushGroup = []
      for (let val of news) {
        if (Number(now - val.post.created_at) > interval) continue
        if (cfg.banWord[type] && new RegExp(cfg.banWord[type]).test(val.post.subject)) continue
        if (val.typeName == "公告")
          for (let botId in cfg[`${type}announceGroup`])
            for (let groupId of cfg[`${type}announceGroup`][botId])
              await this.sendNews(botId, groupId, val.typeName, val.post.post_id, gid)
        if (val.typeName == "资讯")
          for (let botId in cfg[`${type}infoGroup`])
            for (let groupId of cfg[`${type}infoGroup`][botId])
              await this.sendNews(botId, groupId, val.typeName, val.post.post_id, gid)
        if (val.typeName == "活动")
          for (let botId in cfg[`${type}activityGroup`])
            for (let groupId of cfg[`${type}activityGroup`][botId])
              await this.sendNews(botId, groupId, val.typeName, val.post.post_id, gid)
      }
    }
  }

  async ActivityPush() {
    let now = new Date()
    now = now.getHours()
    if (now < 10) return
    let pushGroupList
    try {
      pushGroupList = YAML.parse(
        fs.readFileSync(`./plugins/genshin/config/mys.pushNews.yaml`, `utf8`),
      )
    } catch (error) {
      logger.error(`[米游社活动到期推送] 活动到期预警推送失败：无法获取配置文件信息\n${error}`)
      return
    }
    if (
      (!pushGroupList.gsActivityPush || pushGroupList.gsActivityPush == {}) &&
      (!pushGroupList.srActivityPush || pushGroupList.srActivityPush == {})
    )
      return
    let BotidList = []
    let ActivityPushYaml = { ...pushGroupList.gsActivityPush, ...pushGroupList.srActivityPush }
    for (let item in ActivityPushYaml) {
      BotidList.push(item)
    }
    let gsActivityList = await this.getGsActivity()
    let srActivityList = await this.getSrActivity()
    let ActivityList = []
    for (let item of srActivityList) {
      ActivityList.push({
        game: `sr`,
        subtitle: item.title,
        banner: item.img,
        title: item.title,
        end_time: item.end_time,
      })
    }
    for (let item of gsActivityList) {
      ActivityList.push({
        game: "gs",
        subtitle: item.subtitle,
        banner: item.banner,
        title: item.title,
        end_time: item.end_time,
      })
    }
    if (ActivityList.length === 0) return
    for (let item of BotidList) {
      let redisapgl = await redis.get(`Yz:apgl:${item}`)
      let date = await this.getDate()
      redisapgl = JSON.parse(redisapgl)
      if (!redisapgl || redisapgl.date !== date) {
        redisapgl = {
          date,
          GroupList: ActivityPushYaml[item],
        }
      }
      if (!Array.isArray(redisapgl.GroupList) || redisapgl.GroupList.length == 0) continue
      if (!Bot[item]) {
        redisapgl.GroupList.shift()
        await redis.set(`Yz:apgl:${item}`, JSON.stringify(redisapgl))
        continue
      }
      for (let a of ActivityList) {
        if (
          (!pushGroupList.srActivityPush ||
            !pushGroupList.srActivityPush[item] ||
            !pushGroupList.srActivityPush[item].includes(redisapgl.GroupList[0])) &&
          a.game === `sr`
        )
          continue
        if (
          (!pushGroupList.gsActivityPush ||
            !pushGroupList.gsActivityPush[item] ||
            !pushGroupList.gsActivityPush[item].includes(redisapgl.GroupList[0])) &&
          a.game === `gs`
        )
          continue
        let pushGame
        if (a.game === `sr`) pushGame = `星铁`
        if (a.game === `gs`) pushGame = `原神`
        let endDt = a.end_time
        endDt = endDt.replace(/\s/, `T`)
        let todayt = new Date()
        endDt = new Date(endDt)
        let sydate = await this.calculateRemainingTime(todayt, endDt)
        let msgList = [
          `【${pushGame}活动即将结束通知】`,
          `\n活动:${a.subtitle}`,
          segment.image(a.banner),
          `描述:${a.title}`,
          `\n活动剩余时间:${sydate.days}天${sydate.hours}小时${sydate.minutes}分钟${sydate.seconds}秒`,
          `\n活动结束时间:${a.end_time}`,
        ]
        logger.mark(`[米游社活动到期推送] 开始推送 ${item}:${redisapgl.GroupList[0]} ${a.subtitle}`)
        await common.sleep(5000)
        Bot[item]
          .pickGroup(redisapgl.GroupList[0])
          .sendMsg(msgList)
          .then(() => {})
          .catch(err =>
            logger.error(
              `[米游社活动到期推送] ${item}:${redisapgl.GroupList[0]} 推送失败，错误信息${err}`,
            ),
          )
      }
      redisapgl.GroupList.shift()
      await redis.set(`Yz:apgl:${item}`, JSON.stringify(redisapgl))
    }
    return
  }
  async getDate() {
    const currentDate = new Date()
    const year = currentDate.getFullYear()
    const month = (currentDate.getMonth() + 1).toString().padStart(2, "0")
    const day = currentDate.getDate().toString().padStart(2, "0")
    return `${year}-${month}-${day}`
  }
  async getGsActivity() {
    let gshd
    try {
      gshd = await fetch(
        `https://hk4e-api.mihoyo.com/common/hk4e_cn/announcement/api/getAnnList?game=hk4e&game_biz=hk4e_cn&lang=zh-cn&bundle_id=hk4e_cn&platform=pc&region=cn_gf01&level=55&uid=100000000`,
      )
      gshd = await gshd.json()
    } catch {
      return []
    }
    let hdlist = []
    let result = []
    for (let item of gshd.data.list[1].list) {
      if (
        item.tag_label.includes(`活动`) &&
        !item.title.includes(`传说任务`) &&
        !item.title.includes(`游戏公告`)
      )
        hdlist.push(item)
    }
    for (let item of hdlist) {
      let endDt = item.end_time
      endDt = endDt.replace(/\s/, `T`)
      let todayt = new Date()
      endDt = new Date(endDt)
      let sydate = await this.calculateRemainingTime(todayt, endDt)
      if (sydate.days <= 1) result.push(item)
    }
    return result
  }
  async getSrActivity() {
    let srhd
    try {
      srhd = await fetch(
        `https://hkrpg-api.mihoyo.com/common/hkrpg_cn/announcement/api/getAnnList?game=hkrpg&game_biz=hkrpg_cn&lang=zh-cn&auth_appid=announcement&authkey_ver=1&bundle_id=hkrpg_cn&channel_id=1&level=65&platform=pc&region=prod_gf_cn&sdk_presentation_style=fullscreen&sdk_screen_transparent=true&sign_type=2&uid=100000000`,
      )
      srhd = await srhd.json()
    } catch {
      return []
    }
    let hdlist = []
    let result = []
    for (let item of srhd.data.pic_list[0].type_list[0].list) {
      if (item.title) hdlist.push(item)
    }
    for (let item of hdlist) {
      let endDt = item.end_time
      endDt = endDt.replace(/\s/, `T`)
      let todayt = new Date()
      endDt = new Date(endDt)
      let sydate = await this.calculateRemainingTime(todayt, endDt)
      if (sydate.days <= 1) result.push(item)
    }
    return result
  }
  async calculateRemainingTime(startDate, endDate) {
    const difference = endDate - startDate

    const days = Math.floor(difference / (1000 * 60 * 60 * 24))
    const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60))
    const seconds = Math.floor((difference % (1000 * 60)) / 1000)

    return { days, hours, minutes, seconds }
  }
  async sendNews(botId, groupId, typeName, postId, gid) {
    if (!this.pushGroup[groupId]) this.pushGroup[groupId] = 0
    if (this.pushGroup[groupId] >= this.maxNum) return

    let sended = await redis.get(`${this.key}${botId}:${groupId}:${postId}`)
    if (sended) return

    let game = this.game(gid)
    // 判断是否存在群关系
    this.e.group = Bot[botId]?.pickGroup(groupId)
    if (!this.e.group) {
      logger.mark(`[米游社${game}${typeName}推送] 群${botId}:${groupId}未关联`)
      return
    }

    if (!this[postId]) {
      const param = await this.newsDetail(postId, gid)

      logger.mark(`[米游社${game}${typeName}推送] ${param.data.post.subject}`)

      this[postId] = {
        img: await this.render(param),
        title: param.data.post.subject,
      }
    }

    this.pushGroup[groupId]++
    await redis.set(`${this.key}${botId}:${groupId}:${postId}`, "1", { EX: 3600 * 10 })
    // 随机延迟10-90秒
    await common.sleep(lodash.random(10000, 90000))
    const msg = await this.replyMsg(
      this[postId].img,
      `${game}${typeName}推送：${this[postId].title}`,
    )
    return this.e.group.sendMsg(msg)
  }

  game(gid) {
    switch (gid) {
      case 1:
        return "崩坏三"
      case 2:
        return "原神"
      case 3:
        return "崩坏二"
      case 4:
        return "未定事件簿"
      case 6:
        return "崩坏星穹铁道"
      case 8:
        return "绝区零"
    }
    return ""
  }
}
