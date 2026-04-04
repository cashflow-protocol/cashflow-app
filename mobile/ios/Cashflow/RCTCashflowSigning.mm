#import "RCTCashflowSigning.h"
#import "CashflowSigningBridge.h"

@interface RCTCashflowSigning ()
@property (nonatomic, strong) CashflowSigningBridge *impl;
@end

@implementation RCTCashflowSigning

- (instancetype)init {
  if (self = [super init]) {
    _impl = [[CashflowSigningBridge alloc] init];
  }
  return self;
}

+ (NSString *)moduleName {
  return @"CashflowSigning";
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeCashflowSigningSpecJSI>(params);
}

- (void)generateKeypair:(NSString *)tag
              cloudSync:(BOOL)cloudSync
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject {
  [self.impl generateKeypair:tag cloudSync:cloudSync resolve:resolve reject:reject];
}

- (void)getPublicKey:(NSString *)tag
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject {
  [self.impl getPublicKey:tag resolve:resolve reject:reject];
}

- (void)exportPrivateKey:(NSString *)tag
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject {
  [self.impl exportPrivateKey:tag resolve:resolve reject:reject];
}

- (void)sign:(NSString *)tag
    messageBase64:(NSString *)messageBase64
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject {
  [self.impl sign:tag messageBase64:messageBase64 resolve:resolve reject:reject];
}

- (void)hasKeypair:(NSString *)tag
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject {
  [self.impl hasKeypair:tag resolve:resolve reject:reject];
}

- (void)deleteKeypair:(NSString *)tag
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject {
  [self.impl deleteKeypair:tag resolve:resolve reject:reject];
}

- (void)authenticate:(NSString *)reason
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject {
  [self.impl authenticate:reason resolve:resolve reject:reject];
}

- (void)migrateKeypairsToBiometric:(RCTPromiseResolveBlock)resolve
                            reject:(RCTPromiseRejectBlock)reject {
  [self.impl migrateKeypairsToBiometric:resolve reject:reject];
}

- (void)cachePin:(NSString *)pin
         resolve:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject {
  [self.impl cachePin:pin resolve:resolve reject:reject];
}

- (void)clearCachedPin:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject {
  [self.impl clearCachedPin:resolve reject:reject];
}

- (void)storePinForBiometric:(NSString *)pin
                     resolve:(RCTPromiseResolveBlock)resolve
                      reject:(RCTPromiseRejectBlock)reject {
  [self.impl storePinForBiometric:pin resolve:resolve reject:reject];
}

- (void)retrievePinWithBiometric:(RCTPromiseResolveBlock)resolve
                          reject:(RCTPromiseRejectBlock)reject {
  [self.impl retrievePinWithBiometric:resolve reject:reject];
}

- (void)reEncryptCloudKeyWithPin:(NSString *)newPin
                         resolve:(RCTPromiseResolveBlock)resolve
                          reject:(RCTPromiseRejectBlock)reject {
  [self.impl reEncryptCloudKeyWithPin:newPin resolve:resolve reject:reject];
}

- (void)backupCloudKeyToBlockStore:(NSString *)pin
                           resolve:(RCTPromiseResolveBlock)resolve
                            reject:(RCTPromiseRejectBlock)reject {
  [self.impl backupCloudKeyToBlockStore:pin resolve:resolve reject:reject];
}

- (void)restoreCloudKeyFromBlockStore:(NSString *)pin
                              resolve:(RCTPromiseResolveBlock)resolve
                               reject:(RCTPromiseRejectBlock)reject {
  [self.impl restoreCloudKeyFromBlockStore:pin resolve:resolve reject:reject];
}

- (void)hasBlockStoreBackup:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject {
  [self.impl hasBlockStoreBackup:resolve reject:reject];
}

- (void)isGmsAvailable:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject {
  [self.impl isGmsAvailable:resolve reject:reject];
}

@end
