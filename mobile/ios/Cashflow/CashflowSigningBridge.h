#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// ObjC bridge to CashflowSigningImpl (Swift) — avoids importing
/// Cashflow-Swift.h from ObjC++ which breaks due to ExpoModulesProvider.
@interface CashflowSigningBridge : NSObject

- (void)generateKeypair:(NSString *)tag
              cloudSync:(BOOL)cloudSync
                resolve:(void (^)(id))resolve
                 reject:(void (^)(NSString *, NSString *, NSError *))reject;

- (void)getPublicKey:(NSString *)tag
             resolve:(void (^)(id))resolve
              reject:(void (^)(NSString *, NSString *, NSError *))reject;

- (void)exportPrivateKey:(NSString *)tag
                 resolve:(void (^)(id))resolve
                  reject:(void (^)(NSString *, NSString *, NSError *))reject;

- (void)sign:(NSString *)tag
    messageBase64:(NSString *)messageBase64
          resolve:(void (^)(id))resolve
           reject:(void (^)(NSString *, NSString *, NSError *))reject;

- (void)hasKeypair:(NSString *)tag
           resolve:(void (^)(id))resolve
            reject:(void (^)(NSString *, NSString *, NSError *))reject;

- (void)deleteKeypair:(NSString *)tag
              resolve:(void (^)(id))resolve
               reject:(void (^)(NSString *, NSString *, NSError *))reject;

- (void)authenticate:(NSString *)reason
             resolve:(void (^)(id))resolve
              reject:(void (^)(NSString *, NSString *, NSError *))reject;

- (void)migrateKeypairsToBiometric:(void (^)(id))resolve
                            reject:(void (^)(NSString *, NSString *, NSError *))reject;

- (void)cachePin:(NSString *)pin
         resolve:(void (^)(id))resolve
          reject:(void (^)(NSString *, NSString *, NSError *))reject;

- (void)clearCachedPin:(void (^)(id))resolve
                reject:(void (^)(NSString *, NSString *, NSError *))reject;

- (void)storePinForBiometric:(NSString *)pin
                     resolve:(void (^)(id))resolve
                      reject:(void (^)(NSString *, NSString *, NSError *))reject;

- (void)retrievePinWithBiometric:(void (^)(id))resolve
                          reject:(void (^)(NSString *, NSString *, NSError *))reject;

- (void)reEncryptCloudKeyWithPin:(NSString *)newPin
                         resolve:(void (^)(id))resolve
                          reject:(void (^)(NSString *, NSString *, NSError *))reject;

- (void)backupCloudKeyToBlockStore:(NSString *)pin
                           resolve:(void (^)(id))resolve
                            reject:(void (^)(NSString *, NSString *, NSError *))reject;

- (void)restoreCloudKeyFromBlockStore:(NSString *)pin
                              resolve:(void (^)(id))resolve
                               reject:(void (^)(NSString *, NSString *, NSError *))reject;

- (void)hasBlockStoreBackup:(void (^)(id))resolve
                     reject:(void (^)(NSString *, NSString *, NSError *))reject;

- (void)isGmsAvailable:(void (^)(id))resolve
                reject:(void (^)(NSString *, NSString *, NSError *))reject;

@end

NS_ASSUME_NONNULL_END
