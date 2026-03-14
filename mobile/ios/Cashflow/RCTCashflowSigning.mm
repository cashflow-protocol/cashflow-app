#import "RCTCashflowSigning.h"
#import <React_RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>
#import "Cashflow-Swift.h"

@interface RCTCashflowSigning ()
@property (nonatomic, strong) CashflowSigningImpl *impl;
@end

@implementation RCTCashflowSigning

- (instancetype)init {
  if (self = [super init]) {
    _impl = [[CashflowSigningImpl alloc] init];
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

@end
