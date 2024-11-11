//这个文件就是最根本的文件 调用登陆函数，各个签到文件中的签到函数，还有可以从本地用户调用
import prompts from 'prompts';/你好
import { blue, red } from 'kolorist';
import { getPPTActiveInfo, preSign, traverseCourseActivity } from './functions/activity';
import { GeneralSign } from './functions/general';
import { LocationSign, presetAddressChoices } from './functions/location';
import { getObjectIdFromcxPan, PhotoSign } from './functions/photo';
import { QRCodeSign } from './functions/qrcode';
import { getAccountInfo, getCourses, getLocalUsers, userLogin } from './functions/user';
import { getJsonObject, storeUser } from './utils/file';

const PromptsOptions = {
  onCancel: () => {
    console.log(red('✖') + ' 操作取消');
    process.exit(0);
  },
};//是一个可选项 由用户决定当前操作，在取消操作时输出一个红色的提示消息，然后正常退出程序。

(async function () {
  let params: UserCookieType & { phone?: string; };
  const configs: any = {};
  // 本地与登录之间的抉择
  // 本地与登录之间的抉择，调用 getLocalUsers方法查看是否有本地用户。如有可以选择用户登录
  {
    // 打印本地用户列表，并返回用户数量
    const { userItem } = await prompts({
      type: 'select',
      name: 'userItem',
      message: '选择用户',
      choices: getLocalUsers(),
      initial: 0,
    }, PromptsOptions);
    // 使用新用户登录
    if (userItem === -1) {
      const { phone } = await prompts({ type: 'text', name: 'phone', message: '手机号' }, PromptsOptions);
      const { password } = await prompts({ type: 'password', name: 'password', message: '密码' }, PromptsOptions);
      // 登录获取各参数
      const result = await userLogin(phone, password);//调用 userLogin函数获取用户参数，储存在result
      if (typeof result === 'string') process.exit(0);
      else storeUser(phone, { phone, params: result }); //// 把result参数储存到本地，改名为params储存（注意这是一个立即调用函数，定义的变量是全局变量）
      params = { ...result, phone };//改名为params储存
      console.log(params)
    } else {
      // 使用本地储存的参数（老用户）
      const jsonObject = getJsonObject('configs/storage.json').users[userItem];//getJsonObject方法转化storage.json中的信息为一个Object
      params = { ...jsonObject.params };
       console.log(params)
      params.phone = jsonObject.phone;
      configs.monitor = { ...jsonObject.monitor };
      configs.mailing = { ...jsonObject.mailing };
      configs.cqserver = { ...jsonObject.cqserver };
    }
    if (typeof params === 'string') return;
  }

  // 获取用户名
  const name = await getAccountInfo(params);//params的定义在上面哈，分为新用户和老用户
  console.log(blue(`你好，${name}`));//blue就是把${name}转化为蓝色字体

  // 获取所有课程
  const courses = await getCourses(params._uid, params._d, params.vc3);//params的定义在上面哈，分为新用户和老用户
  if (typeof courses === 'string') process.exit(0);//getCourses函数返回一个courses列表 里面是courseId和classId
  // 获取进行中的签到活动
  const activity = await traverseCourseActivity({ courses, ...params });
  if (typeof activity === 'string') process.exit(0);//如果没有签到活动就退出
  else await preSign({ ...activity, ...params });//如果有签到活动就执行预签

  // 处理签到，先进行预签
  switch (activity.otherId) {
    case 2: {
      // 二维码签到
      //otherId是可以用来判断签到类型
      const { enc } = await prompts({ type: 'text', name: 'enc', message: 'enc(微信或其他识别二维码，可得enc参数)' }, PromptsOptions);
      const defaultLngLat = configs.monitor?.lon ? `${configs.monitor.lon},${configs.monitor.lat}` : '113.516288,34.817038';//经纬度选择
      const defaultAddress = configs.monitor?.address ? configs.monitor.address : '';
      const { lnglat } = await prompts({ type: 'text', name: 'lnglat', message: '经纬度', initial: defaultLngLat }, PromptsOptions);
      const { address } = await prompts({ type: 'text', name: 'address', message: '详细地址', initial: defaultAddress });
      const { altitude } = await prompts({ type: 'text', name: 'altitude', message: '海拔', initial: '100' });
      const lat = lnglat.substring(lnglat.indexOf(',') + 1, lnglat.length);
      const lon = lnglat.substring(0, lnglat.indexOf(','));
      await QRCodeSign({ ...params, activeId: activity.activeId, enc, lat, lon, address, name, altitude });
      break;
    }
    case 4: {
      // 位置签到
      console.log('[获取经纬度]https://api.map.baidu.com/lbsapi/getpoint/index.html');
      if (!configs.monitor.presetAddress) configs.monitor.presetAddress = [];
      const { presetItem } = await prompts({
        type: 'select',
        name: 'presetItem',
        message: '详细地址',
        choices: presetAddressChoices(configs.monitor.presetAddress),
        initial: 0,
      }, PromptsOptions);
      let lon_lat_address: any;
      if (presetItem === -1) {
        // 手动添加
        const { lon_lat_address: result } = await prompts({
          type: 'text',
          name: 'lon_lat_address',
          message: '位置参数预设（经纬度/地址）',
          initial: '113.516288,34.817038/河南省郑州市万科城大学软件楼',
        }, PromptsOptions);
        lon_lat_address = result.match(/([\d.]*),([\d.]*)\/(\S*)/);
        configs.monitor.presetAddress.push({
          lon: lon_lat_address?.[1],
          lat: lon_lat_address?.[2],
          address: lon_lat_address?.[3]
        });
      } else {
        // 选取地址
        lon_lat_address = [
          '填充[0]',
          configs.monitor.presetAddress[presetItem].lon,
          configs.monitor.presetAddress[presetItem].lat,
          configs.monitor.presetAddress[presetItem].address,
        ];
      }

      // 构成预设位置对象
      const addressItem = {
        lon: lon_lat_address?.[1],
        lat: lon_lat_address?.[2],
        address: lon_lat_address?.[3]
      };
      await LocationSign({ ...activity, ...params, ...addressItem, name });

      // 更新本地数据
      configs.monitor = { presetAddress: configs?.monitor.presetAddress, delay: configs?.monitor?.delay || 0 };
      configs.mailing = configs.mailing ? configs.mailing : { enabled: false };
      configs.cqserver = configs.cqserver ? configs.cqserver : { cq_enabled: false };
      break;
    }
    case 3: {
      // 手势签到
      await GeneralSign({ ...activity, ...params, name });
      break;
    }
    case 5: {
      // 签到码签到
      await GeneralSign({ ...activity, ...params, name });
      break;
    }
    case 0: {
      const photo = await getPPTActiveInfo({ activeId: activity.activeId, ...params });
      if (photo.ifphoto === 1) {
        // 拍照签到
        console.log('访问 https://pan-yz.chaoxing.com 并在根目录上传你想要提交的照片，格式为jpg或png，命名为 0.jpg 或 0.png');
        await prompts({ name: 'complete', type: 'confirm', message: '已上传完毕?' });
        // 获取照片objectId
        const objectId = await getObjectIdFromcxPan(params);
        if (objectId === null) return null;
        await PhotoSign({ ...params, activeId: activity.activeId, objectId, name });
      } else {
        // 普通签到
        await GeneralSign({ ...params, activeId: activity.activeId, name });
      }
    }
  }
  // 记录签到信息
  const { phone, ...rest_param } = params;
  if (phone) storeUser(phone, { phone, params: rest_param, ...configs });
})();
