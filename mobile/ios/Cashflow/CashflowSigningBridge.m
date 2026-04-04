#import "CashflowSigningBridge.h"
#import "Cashflow-Swift.h"

@interface CashflowSigningBridge ()
@property (nonatomic, strong) CashflowSigningImpl *impl;
@end

@implementation CashflowSigningBridge

- (instancetype)init {
  if (self = [super init]) {
    _impl = [[CashflowSigningImpl alloc] init];
  }
  return self;
}

- (void)generateKeypair:(NSString *)tag cloudSync:(BOOL)cloudSync resolve:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl generateKeypair:tag cloudSync:cloudSync resolve:resolve reject:reject];
}

- (void)getPublicKey:(NSString *)tag resolve:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl getPublicKey:tag resolve:resolve reject:reject];
}

- (void)exportPrivateKey:(NSString *)tag resolve:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl exportPrivateKey:tag resolve:resolve reject:reject];
}

- (void)sign:(NSString *)tag messageBase64:(NSString *)messageBase64 resolve:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl sign:tag messageBase64:messageBase64 resolve:resolve reject:reject];
}

- (void)hasKeypair:(NSString *)tag resolve:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl hasKeypair:tag resolve:resolve reject:reject];
}

- (void)deleteKeypair:(NSString *)tag resolve:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl deleteKeypair:tag resolve:resolve reject:reject];
}

- (void)authenticate:(NSString *)reason resolve:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl authenticate:reason resolve:resolve reject:reject];
}

- (void)migrateKeypairsToBiometric:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl migrateKeypairsToBiometric:resolve reject:reject];
}

- (void)cachePin:(NSString *)pin resolve:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl cachePin:pin resolve:resolve reject:reject];
}

- (void)clearCachedPin:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl clearCachedPin:resolve reject:reject];
}

- (void)storePinForBiometric:(NSString *)pin resolve:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl storePinForBiometric:pin resolve:resolve reject:reject];
}

- (void)retrievePinWithBiometric:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl retrievePinWithBiometric:resolve reject:reject];
}

- (void)reEncryptCloudKeyWithPin:(NSString *)newPin resolve:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl reEncryptCloudKeyWithPin:newPin resolve:resolve reject:reject];
}

- (void)backupCloudKeyToBlockStore:(NSString *)pin resolve:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl backupCloudKeyToBlockStore:pin resolve:resolve reject:reject];
}

- (void)restoreCloudKeyFromBlockStore:(NSString *)pin resolve:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl restoreCloudKeyFromBlockStore:pin resolve:resolve reject:reject];
}

- (void)hasBlockStoreBackup:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl hasBlockStoreBackup:resolve reject:reject];
}

- (void)isGmsAvailable:(void (^)(id))resolve reject:(void (^)(NSString *, NSString *, NSError *))reject {
  [self.impl isGmsAvailable:resolve reject:reject];
}

@end
